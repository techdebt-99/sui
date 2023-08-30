// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useWalletContext } from 'dapp-kit/src/components/wallet-provider/WalletProvider';
import { WalletNotFoundError } from 'dapp-kit/src/errors/walletErrors';

type SwitchAccountArgs = {
	account: WalletAccount;
};

type SwitchAccountResult = StandardConnectOutput;

type UseSwitchAccountMutationOptions = Omit<
	UseMutationOptions<SwitchAccountResult, Error, SwitchAccountArgs, unknown>,
	'mutationKey' | 'mutationFn'
>;

// TODO: Figure out the query/mutation key story and whether or not we want to expose
// key factories from dapp-kit
function mutationKey(args: SwitchAccountArgs) {
	return [{ scope: 'wallet', entity: 'connect-wallet', ...args }] as const;
}

/**
 * Mutation hook for establishing a connection to a specific wallet.
 */
export function useSwitchAccount({
	account,
	...mutationOptions
}: SwitchAccountArgs & UseSwitchAccountMutationOptions) {
	const { wallets, storageAdapter, storageKey, dispatch } = useWalletContext();

	return useMutation({
		mutationKey: mutationKey({ walletName, silent }),
		mutationFn: async ({ walletName, ...standardConnectInput }) => {
			const wallet = wallets.find((wallet) => wallet.name === walletName);
			if (!wallet) {
				throw new WalletNotFoundError(
					`Failed to connect to wallet with name ${walletName}. Double check that the name provided is correct and that a wallet with that name is registered.`,
				);
			}
			try {
				await storageAdapter.set(storageKey, `${wallet.name}-${0}`);
			} catch {
				/* ignore error */
			}

			return connectResult;
		},
		...mutationOptions,
	});
}