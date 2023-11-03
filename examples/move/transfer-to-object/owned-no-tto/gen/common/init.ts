import * as identifiedPayment from "./identified-payment/structs";
import {StructClassLoader} from "../_framework/loader";

export function registerClasses(loader: StructClassLoader) { loader.register(identifiedPayment.IdentifiedPayment);
loader.register(identifiedPayment.PaymentEvent);
 }
