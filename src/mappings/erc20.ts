import { Transfer as TransferEvent } from '../../generated/templates/ERC20/ERC20';

import { Token, Transfer } from '../../generated/schema';
import { Address } from '@graphprotocol/graph-ts';

const exeDao = '0xCA2De8E8164C11fE30B0c10Ea928a6a6aF1c7fa7';

export function handleERC20Transfer(event : TransferEvent) : void {
    let from = event.params.from;
    let to = event.params.to;
    let exedaoAddress = Address.fromString(exeDao);

    // wait for equals methos to be implemented to ditch toHex()
    if (from.toHex() == exedaoAddress.toHex() || to.toHex() == exedaoAddress.toHex()) {

        let transferId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
        let transfer = new Transfer(transferId);
        transfer.tokenAddress = event.address;
        transfer.sender = event.params.from;
        transfer.recipient = event.params.to;
        transfer.amount = event.params.value;
        transfer.save();

        // update token balance
        let tokenId = event.address.toHex();
        let token = Token.load(tokenId);
        let amount = event.params.value;

        if (from.toHex() == exedaoAddress.toHex()) {
            token.balance = token.balance.minus(amount);
        } else {
            token.balance = token.balance.plus(amount);
        }
        token.save();
    }
} 