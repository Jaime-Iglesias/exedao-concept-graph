// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.

import { Address, DataSourceTemplate } from "@graphprotocol/graph-ts";

export class ERC20 extends DataSourceTemplate {
  static create(address: Address): void {
    DataSourceTemplate.create("ERC20", [address.toHex()]);
  }
}
