// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { fromB64, toB58 } from '@mysten/bcs';
import { beforeAll, describe, expect, it } from 'vitest';

import { bcs } from '../../src/bcs/index';
import { TransactionBlock } from '../../src/builder';
import { parseSerializedSignature } from '../../src/cryptography';
import { SignatureWithBytes } from '../../src/cryptography/keypair';
import {
	combinePartialSigs,
	decodeMultiSig,
	PubkeyWeightPair,
	toMultiSigAddress,
} from '../../src/cryptography/multisig';
import { PublicKey } from '../../src/cryptography/publickey';
import { Ed25519Keypair, Ed25519PublicKey } from '../../src/keypairs/ed25519';
import { Secp256k1Keypair } from '../../src/keypairs/secp256k1';
import { Secp256r1Keypair } from '../../src/keypairs/secp256r1';
import { toZkLoginPublicIdentifier } from '../../src/keypairs/zklogin/publickey';
import {
	MultiSigPublicKey,
	MultiSigStruct,
	parsePartialSignatures,
} from '../../src/multisig/publickey';
import { getZkLoginSignature } from '../../src/zklogin';
import { DEFAULT_RECIPIENT, setupWithFundedAddress } from './utils/setup';

describe('Multisig scenarios', () => {
	it('multisig address creation and combine sigs using Secp256r1Keypair', async () => {
		const k1 = new Ed25519Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const k3 = new Secp256r1Keypair();
		const pk3 = k3.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
		];

		toMultiSigAddress(pubkeyWeightPairs, 3);

		const txb = new TransactionBlock();
		txb.setSender(k3.getPublicKey().toSuiAddress());
		txb.setGasPrice(5);
		txb.setGasBudget(100);
		txb.setGasPayment([
			{
				objectId: (Math.random() * 100000).toFixed(0).padEnd(64, '0'),
				version: String((Math.random() * 10000).toFixed(0)),
				digest: toB58(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
			},
		]);
		const bytes = await txb.build();

		const { signature } = await k3.signTransactionBlock(bytes);

		const multisig = combinePartialSigs([signature], pubkeyWeightPairs, 3);

		expect(await k3.getPublicKey().verifyTransactionBlock(bytes, signature)).toEqual(true);

		const parsed = parseSerializedSignature(multisig);
		const publicKey = new MultiSigPublicKey(parsed.multisig!.multisig_pk);

		// multisig (sig3 weight 3 >= threshold ) verifies ok
		expect(await publicKey.verifyTransactionBlock(bytes, multisig)).toEqual(true);
	});

	it('comparison of combined signatures provided via different methods', async () => {
		const k1 = new Ed25519Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const k3 = new Secp256r1Keypair();
		const pk3 = k3.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
				{ publicKey: pk3, weight: 3 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);
		const sig3 = await k3.signPersonalMessage(signData);
		const isValid1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		expect(isValid1).toBe(true);
		const isValid2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);
		expect(isValid2).toBe(true);
		const isValid3 = await k3.getPublicKey().verifyPersonalMessage(signData, sig3.signature);
		expect(isValid3).toBe(true);

		// multisig.ts
		const combinedM = combinePartialSigs(
			[sig1.signature, sig2.signature, sig3.signature],
			pubkeyWeightPairs,
			3,
		);
		// publickey.ts
		const combinedP = multiSigPublicKey.combinePartialSignatures([
			sig1.signature,
			sig2.signature,
			sig3.signature,
		]);

		let decodedM = decodeMultiSig(combinedM);
		let decodedP = decodeMultiSig(combinedP);

		//Comparison
		expect(combinedM).toEqual(combinedP);

		expect(decodedM).toEqual(decodedP);
		expect(decodedM).toEqual([
			{
				signature: parseSerializedSignature((await k1.signPersonalMessage(signData)).signature)
					.signature,
				signatureScheme: k1.getKeyScheme(),
				pubKey: pk1,
				weight: 1,
			},
			{
				signature: parseSerializedSignature((await k2.signPersonalMessage(signData)).signature)
					.signature,
				signatureScheme: k2.getKeyScheme(),
				pubKey: pk2,
				weight: 2,
			},
			{
				signature: parseSerializedSignature((await k3.signPersonalMessage(signData)).signature)
					.signature,
				signatureScheme: k3.getKeyScheme(),
				pubKey: pk3,
				weight: 3,
			},
		]);
	});

	it('comparison of decoded/parsed multisig provided via different methods', async () => {
		const k1 = new Ed25519Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const k3 = new Secp256r1Keypair();
		const pk3 = k3.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
				{ publicKey: pk3, weight: 3 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);

		const isValidSig1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		const isValidSig2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);

		expect(isValidSig1).toBe(true);
		expect(isValidSig2).toBe(true);

		// multisig.ts
		const combinedM = combinePartialSigs([sig1.signature, sig2.signature], pubkeyWeightPairs, 3);
		// publickey.ts
		const combinedP = multiSigPublicKey.combinePartialSignatures([sig1.signature, sig2.signature]);

		const bytes = fromB64(combinedP);
		const multiSigStruct: MultiSigStruct = bcs.de('MultiSig', bytes.slice(1));

		let decodedM = decodeMultiSig(combinedM);
		let parsedP = parsePartialSignatures(multiSigStruct);

		//Comparison
		expect(combinedM).toEqual(combinedP);

		// The difference between methods is naming of 'pubKey' and 'publicKey' respectively.
		expect(decodedM).toEqual([
			{
				signature: parseSerializedSignature((await k1.signPersonalMessage(signData)).signature)
					.signature,
				signatureScheme: k1.getKeyScheme(),
				pubKey: pk1,
				weight: 1,
			},
			{
				signature: parseSerializedSignature((await k2.signPersonalMessage(signData)).signature)
					.signature,
				signatureScheme: k2.getKeyScheme(),
				pubKey: pk2,
				weight: 2,
			},
		]);

		// The difference between methods is naming of 'pubKey' and 'publicKey' respectively.
		expect(parsedP).toEqual([
			{
				signature: parseSerializedSignature((await k1.signPersonalMessage(signData)).signature)
					.signature,
				signatureScheme: k1.getKeyScheme(),
				publicKey: pk1,
				weight: 1,
			},
			{
				signature: parseSerializedSignature((await k2.signPersonalMessage(signData)).signature)
					.signature,
				signatureScheme: k2.getKeyScheme(),
				publicKey: pk2,
				weight: 2,
			},
		]);

		// Only because of naming there is no 100% similarity.
		expect(parsedP).not.toEqual(decodedM);

		// Inside of pubkeys is 100% similarity.
		expect(parsedP[0].publicKey).toEqual(decodedM[0].pubKey);
		expect(parsedP[1].publicKey).toEqual(decodedM[1].pubKey);

		// Other.
		expect(parsedP[0].signature).toEqual(decodedM[0].signature);
		expect(parsedP[1].signature).toEqual(decodedM[1].signature);
		expect(parsedP[0].signatureScheme).toEqual(decodedM[0].signatureScheme);
		expect(parsedP[1].signatureScheme).toEqual(decodedM[1].signatureScheme);
		expect(parsedP[0].weight).toEqual(decodedM[0].weight);
		expect(parsedP[1].weight).toEqual(decodedM[1].weight);
	});

	it('providing false number of signatures to combining via different methods', async () => {
		const k1 = new Ed25519Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const k3 = new Secp256r1Keypair();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);
		const sig3 = await k3.signPersonalMessage(signData);

		const isValidSig1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		const isValidSig2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);

		expect(isValidSig1).toBe(true);
		expect(isValidSig2).toBe(true);

		// multisig.ts
		const multisig = combinePartialSigs([sig1.signature, sig3.signature], pubkeyWeightPairs, 3);

		// publickey.ts
		expect(() =>
			multiSigPublicKey.combinePartialSignatures([sig1.signature, sig3.signature]),
		).toThrowError(new Error('Received signature from unknown public key'));

		const parsed = parseSerializedSignature(multisig);
		const publicKey = new MultiSigPublicKey(parsed.multisig!.multisig_pk);

		await expect(publicKey.verifyPersonalMessage(signData, multisig)).rejects.toThrow(
			new Error("Cannot read properties of undefined (reading 'pubKey')"),
		);
	});

	it('providing the same signature multiple times to combining via different methods', async () => {
		const k1 = new Ed25519Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);

		const isValidSig1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		const isValidSig2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);

		expect(isValidSig1).toBe(true);
		expect(isValidSig2).toBe(true);

		// multisig.ts
		const multisig = combinePartialSigs([sig2.signature, sig2.signature], pubkeyWeightPairs, 3);

		// publickey.ts
		expect(() =>
			multiSigPublicKey.combinePartialSignatures([sig2.signature, sig2.signature]),
		).toThrowError(new Error('Received multiple signatures from the same public key'));

		const parsed = parseSerializedSignature(multisig);
		const publicKey = new MultiSigPublicKey(parsed.multisig!.multisig_pk);

		await expect(publicKey.verifyPersonalMessage(signData, multisig)).rejects.toThrow(
			new Error("Cannot read properties of undefined (reading 'pubKey')"),
		);
	});

	it('providing invalid signature', async () => {
		const k1 = new Ed25519Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);

		// Invalid Signature.
		const sig3: SignatureWithBytes = {
			bytes: 'd',
			signature: 'd',
		};

		const isValidSig1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		const isValidSig2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);

		expect(isValidSig1).toBe(true);
		expect(isValidSig2).toBe(true);

		// multisig.ts
		expect(() => combinePartialSigs([sig3.signature], pubkeyWeightPairs, 3)).toThrow(
			new Error(`Unsupported signature scheme`),
		);

		// publickey.ts
		expect(() => multiSigPublicKey.combinePartialSignatures([sig3.signature])).toThrow(
			new Error(`Unsupported signature scheme`),
		);
	});

	it('providing signatures with invalid order', async () => {
		const k1 = new Secp256r1Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);

		const isValidSig1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		const isValidSig2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);

		expect(isValidSig1).toBe(true);
		expect(isValidSig2).toBe(true);

		// multisig.ts
		const multisig = combinePartialSigs([sig2.signature, sig1.signature], pubkeyWeightPairs, 3);

		// publickey.ts
		const multisigP = multiSigPublicKey.combinePartialSignatures([sig2.signature, sig1.signature]);

		const parsed = parseSerializedSignature(multisig);
		const publicKey = new MultiSigPublicKey(parsed.multisig!.multisig_pk);

		// Invalid order can't be verified.
		expect(await publicKey.verifyPersonalMessage(signData, multisig)).toEqual(false);
		expect(await multiSigPublicKey.verifyPersonalMessage(signData, multisigP)).toEqual(false);
	});

	it('providing invalid intent scope', async () => {
		const k1 = new Secp256r1Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);

		const isValidSig1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		const isValidSig2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);

		expect(isValidSig1).toBe(true);
		expect(isValidSig2).toBe(true);

		// multisig.ts
		const multisig = combinePartialSigs([sig1.signature, sig2.signature], pubkeyWeightPairs, 3);

		// publickey.ts
		const multisigP = multiSigPublicKey.combinePartialSignatures([sig1.signature, sig2.signature]);

		const parsed = parseSerializedSignature(multisig);
		const publicKey = new MultiSigPublicKey(parsed.multisig!.multisig_pk);

		// Invalid intentScope.
		expect(await publicKey.verifyTransactionBlock(signData, multisig)).toEqual(false);
		expect(await multiSigPublicKey.verifyTransactionBlock(signData, multisigP)).toEqual(false);
	});

	it('providing empty values', async () => {
		const k1 = new Secp256r1Keypair();
		const pk1 = k1.getPublicKey();

		const k2 = new Secp256k1Keypair();
		const pk2 = k2.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
		];
		toMultiSigAddress(pubkeyWeightPairs, 3);

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold: 3,
			publicKeys: [
				{ publicKey: pk1, weight: 1 },
				{ publicKey: pk2, weight: 2 },
			],
		});

		const signData = new TextEncoder().encode('hello world');
		const sig1 = await k1.signPersonalMessage(signData);
		const sig2 = await k2.signPersonalMessage(signData);

		const isValidSig1 = await k1.getPublicKey().verifyPersonalMessage(signData, sig1.signature);
		const isValidSig2 = await k2.getPublicKey().verifyPersonalMessage(signData, sig2.signature);

		expect(isValidSig1).toBe(true);
		expect(isValidSig2).toBe(true);

		// multisig.ts
		// Empty values.
		const multisig = combinePartialSigs([], pubkeyWeightPairs, 3);

		// publickey.ts
		// Empty values.
		const multisigP = multiSigPublicKey.combinePartialSignatures([]);

		const parsed = parseSerializedSignature(multisig);
		const publicKey = new MultiSigPublicKey(parsed.multisig!.multisig_pk);

		// Rejects verification.
		expect(await publicKey.verifyTransactionBlock(signData, multisig)).toEqual(false);
		expect(await multiSigPublicKey.verifyTransactionBlock(signData, multisigP)).toEqual(false);
	});
});

describe('Multisig address creation:', () => {
	let k1: Ed25519Keypair,
		pk1: Ed25519PublicKey,
		k2: Secp256k1Keypair,
		pk2: PublicKey,
		k3: Secp256r1Keypair,
		pk3: PublicKey;

	beforeAll(() => {
		k1 = new Ed25519Keypair();
		pk1 = k1.getPublicKey();

		k2 = new Secp256k1Keypair();
		pk2 = k2.getPublicKey();

		k3 = new Secp256r1Keypair();
		pk3 = k3.getPublicKey();
	});

	it('with unreachable threshold', async () => {
		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
		];

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 7)).toThrow(
			new Error('Unreachable threshold'),
		);

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 7,
				publicKeys: [
					{ publicKey: pk1, weight: 1 },
					{ publicKey: pk2, weight: 2 },
					{ publicKey: pk3, weight: 3 },
				],
			}),
		).toThrow(new Error('Unreachable threshold'));
	});

	it('with more public keys than limited number', async () => {
		const k4 = new Secp256r1Keypair();
		const pk4 = k4.getPublicKey();

		const k5 = new Secp256r1Keypair();
		const pk5 = k5.getPublicKey();

		const k6 = new Secp256r1Keypair();
		const pk6 = k6.getPublicKey();

		const k7 = new Secp256r1Keypair();
		const pk7 = k7.getPublicKey();

		const k8 = new Secp256r1Keypair();
		const pk8 = k8.getPublicKey();

		const k9 = new Secp256r1Keypair();
		const pk9 = k9.getPublicKey();

		const k10 = new Secp256r1Keypair();
		const pk10 = k10.getPublicKey();

		const k11 = new Secp256r1Keypair();
		const pk11 = k11.getPublicKey();

		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
			{
				pubKey: pk4,
				weight: 4,
			},
			{
				pubKey: pk5,
				weight: 5,
			},
			{
				pubKey: pk6,
				weight: 1,
			},
			{
				pubKey: pk7,
				weight: 2,
			},
			{
				pubKey: pk8,
				weight: 3,
			},
			{
				pubKey: pk9,
				weight: 4,
			},
			{
				pubKey: pk10,
				weight: 5,
			},
			{
				pubKey: pk11,
				weight: 6,
			},
		];

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 10)).toThrowError(
			new Error('Max number of signers in a multisig is 10'),
		);

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 10,
				publicKeys: [
					{ publicKey: pk1, weight: 1 },
					{ publicKey: pk2, weight: 2 },
					{ publicKey: pk3, weight: 3 },
					{ publicKey: pk4, weight: 4 },
					{ publicKey: pk5, weight: 5 },
					{ publicKey: pk6, weight: 1 },
					{ publicKey: pk7, weight: 2 },
					{ publicKey: pk8, weight: 3 },
					{ publicKey: pk9, weight: 4 },
					{ publicKey: pk10, weight: 5 },
					{ publicKey: pk11, weight: 6 },
				],
			}),
		).toThrowError(new Error('Max number of signers in a multisig is 10'));
	});

	it('with max weights and max threshold values', async () => {
		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 256,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
		];

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 65536)).toThrow(
			new Error('Invalid threshold'),
		);

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 65535)).toThrow(new Error('Invalid weight'));

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 65535,
				publicKeys: [
					{ publicKey: pk1, weight: 1 },
					{ publicKey: pk2, weight: 256 },
					{ publicKey: pk3, weight: 3 },
				],
			}),
		).toThrow(new Error('Invalid u8 value: 256. Expected value in range 0-255'));

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 65536,
				publicKeys: [
					{ publicKey: pk1, weight: 1 },
					{ publicKey: pk2, weight: 2 },
					{ publicKey: pk3, weight: 3 },
				],
			}),
		).toThrow(new Error('Invalid u16 value: 65536. Expected value in range 0-65535'));
	});

	it('with zero weight value', async () => {
		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 0,
			},
			{
				pubKey: pk2,
				weight: 6,
			},
			{
				pubKey: pk3,
				weight: 10,
			},
		];

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 10)).toThrow(new Error('Invalid weight'));

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 10,
				publicKeys: [
					{ publicKey: pk1, weight: 0 },
					{ publicKey: pk2, weight: 6 },
					{ publicKey: pk3, weight: 10 },
				],
			}),
		).toThrow(new Error('Invalid weight'));
	});

	it('with zero threshold value', async () => {
		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk2,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
		];

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 0)).toThrow(new Error('Invalid threshold'));

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 0,
				publicKeys: [
					{ publicKey: pk1, weight: 1 },
					{ publicKey: pk2, weight: 2 },
					{ publicKey: pk3, weight: 3 },
				],
			}),
		).toThrow(new Error('Invalid threshold'));
	});

	it('with empty values', async () => {
		const pubkeyWeightPairs: PubkeyWeightPair[] = [];

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 10)).toThrow(
			new Error('Min number of signers in a multisig is 1'),
		);

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 2,
				publicKeys: [],
			}),
		).toThrow(new Error('Unreachable threshold'));
	});

	it('with duplicated publickeys', async () => {
		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pk1,
				weight: 1,
			},
			{
				pubKey: pk1,
				weight: 2,
			},
			{
				pubKey: pk3,
				weight: 3,
			},
		];

		expect(() => toMultiSigAddress(pubkeyWeightPairs, 4)).toThrow(
			new Error('Multisig does not support duplicate public keys'),
		);

		expect(() =>
			MultiSigPublicKey.fromPublicKeys({
				threshold: 4,
				publicKeys: [
					{ publicKey: pk1, weight: 1 },
					{ publicKey: pk1, weight: 2 },
					{ publicKey: pk3, weight: 3 },
				],
			}),
		).toThrow(new Error('Multisig does not support duplicate public keys'));
	});
});
describe('MultiSig with zklogin signature:', () => {
	it('Execute tx with multisig with 1 sig and 1 zkLogin sig combined', async () => {
		// set up default zklogin public identifier consistent with default zklogin proof.
		let pkZklogin = toZkLoginPublicIdentifier(
			BigInt('20794788559620669596206457022966176986688727876128223628113916380927502737911'),
			'https://id.twitch.tv/oauth2',
		);
		// set up ephemeral keypair, consistent with default zklogin proof.
		let ephemeralKeypair = Ed25519Keypair.fromSecretKey(
			new Uint8Array([
				155, 244, 154, 106, 7, 85, 249, 83, 129, 31, 206, 18, 95, 38, 131, 213, 4, 41, 195, 187, 73,
				224, 116, 20, 126, 0, 137, 165, 46, 174, 21, 95,
			]),
		);

		// set up default single keypair.
		let kp = Ed25519Keypair.fromSecretKey(
			new Uint8Array([
				126, 57, 195, 235, 248, 196, 105, 68, 115, 164, 8, 221, 100, 250, 137, 160, 245, 43, 220,
				168, 250, 73, 119, 95, 19, 242, 100, 105, 81, 114, 86, 105,
			]),
		);
		let pkSingle = kp.getPublicKey();
		console.log('pk single', pkSingle);
		// construct multisig address.
		const pubkeyWeightPairs: PubkeyWeightPair[] = [
			{
				pubKey: pkSingle, // traditional ed25519 key
				weight: 1,
			},
			{
				pubKey: pkZklogin, // zk public identifier
				weight: 1,
			},
		];

		let multisigAddr = toMultiSigAddress(pubkeyWeightPairs, 1);
		expect(multisigAddr === '0xb9c0780a3943cde13a2409bf1a6f06ae60b0dff2b2f373260cf627aa4f43a588'); // fund multisig address.
		let toolbox = await setupWithFundedAddress(kp, multisigAddr);

		// construct a transfer from the multisig address.
		const txb = new TransactionBlock();
		txb.setSenderIfNotSet(multisigAddr);
		const coin = txb.splitCoins(txb.gas, [1]);
		txb.transferObjects([coin], DEFAULT_RECIPIENT);
		let client = toolbox.client;
		let bytes = await txb.build({ client: toolbox.client });

		// sign with the single keypair.
		const singleSig = (await kp.signTransactionBlock(bytes)).signature;

		// construct default zklogin inputs defined in rust: https://github.com/MystenLabs/sui/blob/577537c76281b95ab8036b21e8ca5a25fde5d4b5/crates/sui-types/src/zk_login_util.rs
		const zkLoginInputs = {
			addressSeed: '20794788559620669596206457022966176986688727876128223628113916380927502737911',
			headerBase64: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjEifQ',
			issBase64Details: {
				indexMod4: 2,
				value: 'wiaXNzIjoiaHR0cHM6Ly9pZC50d2l0Y2gudHYvb2F1dGgyIiw',
			},
			proofPoints: {
				a: [
					'17318089125952421736342263717932719437717844282410187957984751939942898251250',
					'11373966645469122582074082295985388258840681618268593976697325892280915681207',
					'1',
				],
				b: [
					[
						'5939871147348834997361720122238980177152303274311047249905942384915768690895',
						'4533568271134785278731234570361482651996740791888285864966884032717049811708',
					],
					[
						'10564387285071555469753990661410840118635925466597037018058770041347518461368',
						'12597323547277579144698496372242615368085801313343155735511330003884767957854',
					],
					['1', '0'],
				],
				c: [
					'15791589472556826263231644728873337629015269984699404073623603352537678813171',
					'4547866499248881449676161158024748060485373250029423904113017422539037162527',
					'1',
				],
			},
		};
		const ephemeralSig = (await ephemeralKeypair.signTransactionBlock(bytes)).signature;
		// create zklogin signature based on default zk proof.
		const zkLoginSig = getZkLoginSignature({
			inputs: zkLoginInputs,
			maxEpoch: '10',
			userSignature: fromB64(ephemeralSig),
		});

		// combine to multisig and execute the transaction.
		const signature = combinePartialSigs([singleSig, zkLoginSig], pubkeyWeightPairs, 1);
		let result = await client.executeTransactionBlock({
			transactionBlock: bytes,
			signature,
			options: { showEffects: true },
		});

		// check the execution result and digest.
		const localDigest = await txb.getDigest({ client });
		expect(localDigest).toEqual(result.digest);
		expect(result.effects?.status.status).toEqual('success');
	});
});
