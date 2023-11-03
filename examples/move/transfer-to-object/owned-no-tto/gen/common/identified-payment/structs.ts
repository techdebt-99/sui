import {bcsSource as bcs} from "../../_framework/bcs";
import {FieldsWithTypes, Type} from "../../_framework/util";
import {Coin} from "../../sui/coin/structs";
import {UID} from "../../sui/object/structs";
import {Encoding} from "@mysten/bcs";
import {SuiClient, SuiParsedData} from "@mysten/sui.js/client";

/* ============================== IdentifiedPayment =============================== */

bcs.registerStructType( "0x0::identified_payment::IdentifiedPayment", {
id: `0x2::object::UID`,
payment_id: `u64`,
coin: `0x2::coin::Coin<0x2::sui::SUI>`,
} )

export function isIdentifiedPayment(type: Type): boolean { return type === "0x0::identified_payment::IdentifiedPayment"; }

export interface IdentifiedPaymentFields { id: string; paymentId: bigint; coin: Coin }

export class IdentifiedPayment { static readonly $typeName = "0x0::identified_payment::IdentifiedPayment"; static readonly $numTypeParams = 0;

 ; readonly id: string; readonly paymentId: bigint; readonly coin: Coin

 constructor( fields: IdentifiedPaymentFields, ) { this.id = fields.id;; this.paymentId = fields.paymentId;; this.coin = fields.coin; }

 static fromFields( fields: Record<string, any> ): IdentifiedPayment { return new IdentifiedPayment( { id: UID.fromFields(fields.id).id, paymentId: BigInt(fields.payment_id), coin: Coin.fromFields(`0x2::sui::SUI`, fields.coin) } ) }

 static fromFieldsWithTypes(item: FieldsWithTypes): IdentifiedPayment { if (!isIdentifiedPayment(item.type)) { throw new Error("not a IdentifiedPayment type");

 } return new IdentifiedPayment( { id: item.fields.id.id, paymentId: BigInt(item.fields.payment_id), coin: Coin.fromFieldsWithTypes(item.fields.coin) } ) }

 static fromBcs( data: Uint8Array | string, encoding?: Encoding ): IdentifiedPayment { return IdentifiedPayment.fromFields( bcs.de([IdentifiedPayment.$typeName, ], data, encoding) ) }

 static fromSuiParsedData(content: SuiParsedData) { if (content.dataType !== "moveObject") { throw new Error("not an object"); } if (!isIdentifiedPayment(content.type)) { throw new Error(`object at ${(content.fields as any).id} is not a IdentifiedPayment object`); } return IdentifiedPayment.fromFieldsWithTypes(content); }

 static async fetch(client: SuiClient, id: string ): Promise<IdentifiedPayment> { const res = await client.getObject({ id, options: { showContent: true, }, }); if (res.error) { throw new Error(`error fetching IdentifiedPayment object at id ${id}: ${res.error.code}`); } if (res.data?.content?.dataType !== "moveObject" || !isIdentifiedPayment(res.data.content.type)) { throw new Error(`object at id ${id} is not a IdentifiedPayment object`); }
 return IdentifiedPayment.fromFieldsWithTypes(res.data.content); }

 }

/* ============================== PaymentEvent =============================== */

bcs.registerStructType( "0x0::identified_payment::PaymentEvent", {
payment_id: `u64`,
payed_to: `address`,
payment_amount: `u64`,
originator: `address`,
} )

export function isPaymentEvent(type: Type): boolean { return type === "0x0::identified_payment::PaymentEvent"; }

export interface PaymentEventFields { paymentId: bigint; payedTo: string; paymentAmount: bigint; originator: string }

export class PaymentEvent { static readonly $typeName = "0x0::identified_payment::PaymentEvent"; static readonly $numTypeParams = 0;

 ; readonly paymentId: bigint; readonly payedTo: string; readonly paymentAmount: bigint; readonly originator: string

 constructor( fields: PaymentEventFields, ) { this.paymentId = fields.paymentId;; this.payedTo = fields.payedTo;; this.paymentAmount = fields.paymentAmount;; this.originator = fields.originator; }

 static fromFields( fields: Record<string, any> ): PaymentEvent { return new PaymentEvent( { paymentId: BigInt(fields.payment_id), payedTo: `0x${fields.payed_to}`, paymentAmount: BigInt(fields.payment_amount), originator: `0x${fields.originator}` } ) }

 static fromFieldsWithTypes(item: FieldsWithTypes): PaymentEvent { if (!isPaymentEvent(item.type)) { throw new Error("not a PaymentEvent type");

 } return new PaymentEvent( { paymentId: BigInt(item.fields.payment_id), payedTo: `0x${item.fields.payed_to}`, paymentAmount: BigInt(item.fields.payment_amount), originator: `0x${item.fields.originator}` } ) }

 static fromBcs( data: Uint8Array | string, encoding?: Encoding ): PaymentEvent { return PaymentEvent.fromFields( bcs.de([PaymentEvent.$typeName, ], data, encoding) ) }

 }
