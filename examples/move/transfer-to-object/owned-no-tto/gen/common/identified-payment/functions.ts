import {PUBLISHED_AT} from "..";
import {ObjectArg, obj, pure} from "../../_framework/util";
import {TransactionArgument, TransactionBlock} from "@mysten/sui.js/transactions";

export interface MakePaymentArgs { paymentId: bigint | TransactionArgument; coin: ObjectArg; to: string | TransactionArgument }

export function makePayment( txb: TransactionBlock, args: MakePaymentArgs ) { return txb.moveCall({ target: `${PUBLISHED_AT}::identified_payment::make_payment`, arguments: [ pure(txb, args.paymentId, `u64`), obj(txb, args.coin), pure(txb, args.to, `address`) ], }) }

export interface MakeSharedPaymentArgs { registerUid: ObjectArg; paymentId: bigint | TransactionArgument; coin: ObjectArg }

export function makeSharedPayment( txb: TransactionBlock, args: MakeSharedPaymentArgs ) { return txb.moveCall({ target: `${PUBLISHED_AT}::identified_payment::make_shared_payment`, arguments: [ obj(txb, args.registerUid), pure(txb, args.paymentId, `u64`), obj(txb, args.coin) ], }) }

export function unpack( txb: TransactionBlock, identifiedPayment: ObjectArg ) { return txb.moveCall({ target: `${PUBLISHED_AT}::identified_payment::unpack`, arguments: [ obj(txb, identifiedPayment) ], }) }
