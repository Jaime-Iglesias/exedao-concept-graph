import {
  ApplicationAdded as ApplicationAddedEvent,
  ApplicationCanceled as ApplicationCanceledEvent,
  ExtensionAdded as ExtensionAddedEvent,
  ProposalSubmission as ProposalSubmissionEvent,
  ProposalVote as ProposalVoteEvent,
  ProposalApproval as ProposalApprovalEvent,
  ProposalExpiration as ProposalExpirationEvent,
  SharesBurned as SharesBurnedEvent,
  SharesMinted as SharesMintedEvent,
  TokenAdded as TokenAddedEvent,
  TokenRemoved as TokenRemovedEvent,
  TokenTransferred as TokenTransferredEvent,
  TokenReceived as TokenReceivedEvent,
  ExeDAO
} from '../../generated/ExeDAO/ExeDAO';

import {
  Daoist,
  Application,
  Proposal,
  Extension,
  Token,
  ProposalVote,
  MetaData
} from '../../generated/schema';

import { ERC20 as ERC20Template } from '../../generated/templates';
import { ERC20 } from '../../generated/templates/ERC20/ERC20';

import { log, BigInt, Bytes, Address, ipfs, json, JSONValue, Value } from '@graphprotocol/graph-ts';

// APPLICATION

export function handleApplicationAdded(event : ApplicationAddedEvent) : void {
  let applicationId = event.params.applicant.toHex();
  let application = new Application(applicationId);
  application.tokenTributes = [];
  application.tokenTributeValues = [];
  application.acceptedAtBlock = BigInt.fromI32(0);
  application.canceledAtBlock = BigInt.fromI32(0);

  // get full application info from contract
  let exedao = ExeDAO.bind(event.address);
  let applicationInfo = exedao.getApplication(event.params.applicant);
  application.submitter = applicationInfo.applicant;
  application.shares = applicationInfo.shares;
  application.metaData = applicationInfo.metaHash.toHex();
  application.txHash = event.transaction.hash;
  application.weiTribute = applicationInfo.weiTribute;

  // fill tributes (type conversion needed)
  let tributesInfo = applicationInfo.tokenTributes;
  let tributes = application.tokenTributes;
  for (let i = 0; i < tributesInfo.length; i++) {
    tributes.push(tributesInfo[i] as Address);
  }

  application.tokenTributes = tributes;
  application.tokenTributeValues = applicationInfo.tokenTributeValues;

  // IPFS resolve
  let hash = applicationInfo.metaHash.toHex();
  fetchMetaData(hash);

  application.save();
}

export function handleApplicationCanceled(event : ApplicationCanceledEvent) : void {
  let applicationId = event.params.applicant.toHex();
  let application = Application.load(applicationId);
  application.id = applicationId + '-' + event.transaction.hash.toHex();
  application.canceledAtBlock = event.block.number;
  application.save();
}

// DAOIST

export function handleSharesMinted(event : SharesMintedEvent) : void {
  let daoistId = event.params.daoist.toHex();
  let daoist = Daoist.load(daoistId);
  // New Daoist ?
  if (daoist !== null) {
    daoist.shares = daoist.shares.plus(event.params.shares);
  } else {
    daoist = new Daoist(daoistId);
    daoist.shares = event.params.shares;
    let application = Application.load(daoistId);
    // the deployer of the contract is a daoist without application.
    if (application !== null) {
      application.acceptedAtBlock = event.block.number;
      application.save();     
    }
  }
  daoist.save();
}

export function handleSharesBurned(event : SharesBurnedEvent) : void {
  let daoistId = event.params.daoist.toHex();
  let daoist = Daoist.load(daoistId);
  daoist.shares = daoist.shares.minus(event.params.shares);
  daoist.save(); 
}

// TOKEN

export function handleTokenAdded(event : TokenAddedEvent) : void {
  let tokenId = event.params.tokenAddress.toHex();
  let token = Token.load(tokenId);

  // if the token was not previously added...
  if (token == null) {
    // add ERC20 contract indexing
    ERC20Template.create(event.params.tokenAddress);

    token = new Token(tokenId);
    token.balance = BigInt.fromI32(0);
    token.name = "Unnamed ERC20";
    token.symbol = 'ERC20';
    token.decimals = BigInt.fromI32(18);

    // try to fetch optional fields (ONLY RELIABLE WHEN CONNECTED TO A PARITY CLIENT)
    // apparently this has been fixed and also works when connect to non-parity clients ?? -> https://github.com/graphprotocol/graph-node/releases/tag/v0.15.1
    let tokenContract = ERC20.bind(event.params.tokenAddress);
    
    let decimalsCall = tokenContract.try_decimals();
    let symbolCall = tokenContract.try_name();
    let nameCall = tokenContract.try_symbol();

    if (!decimalsCall.reverted) {
      token.decimals = BigInt.fromI32(decimalsCall.value);
    }
    if (!symbolCall.reverted) {
      token.symbol = symbolCall.value;
    }
    if (!nameCall.reverted) {
      token.name = nameCall.value;
    }
  }
  token.admitted = true;
  token.save();
} 

export function handleTokenRemoved(event : TokenRemovedEvent) : void {
  let tokenId = event.params.tokenAddress.toHex();
  let token = Token.load(tokenId);
  token.admitted = false;
  token.save();
}

// this two handlers are no longer implemented since we are using ERC20 templates.
export function handleTokenTransferred(event : TokenTransferredEvent) : void {}

export function handleTokenReceived(event : TokenReceivedEvent) : void {}

// PROPOSAL

//export function handleProposalSubmission(event : ProposalSubmissionEvent) : void {}

//export function handleProposalApproval(event : ProposalApprovalEvent) : void {}

//export function handleProposalExpiration(event: ProposalExpirationEvent): void {}

export function handleProposalSubmission(event : ProposalSubmissionEvent) : void {
  // the submitter also votes the proposal on creation.
  let voteId = event.params.submitter.toHex() + '-' + event.params.proposalHash.toHex();
  let vote = new ProposalVote(voteId);
  vote.voter = event.params.submitter.toHex();
  vote.proposal = event.params.proposalHash.toHex();
  vote.votes = event.params.votesCast;
  vote.save();

  let proposalId = event.params.proposalHash.toHex();
  let proposal = new Proposal(proposalId);
  
  // fetch extra proposal info not contained in the event.
  let exedao = ExeDAO.bind(event.address);
  let proposalInfo = exedao.getProposal(event.params.proposalHash);
  proposal.submitter = event.params.submitter.toHex();
  proposal.metaData = proposalInfo.metaHash.toHex();
  proposal.txHash = event.transaction.hash;
  proposal.index = proposalInfo.proposalIndex;
  proposal.expirationBlock = proposalInfo.expiryBlock;
  proposal.acceptedAtBlock = BigInt.fromI32(0);
  proposal.expired = false;

  // IPFS resolve
  let hash = proposalInfo.metaHash.toHex();
  fetchMetaData(hash);

  proposal.save();
}

export function handleProposalVote(event : ProposalVoteEvent) : void {
  let voteId = event.params.voter.toHex() + '-' + event.params.proposalHash.toHex();
  let vote = new ProposalVote(voteId);
  vote.voter = event.params.voter.toHex();
  vote.proposal = event.params.proposalHash.toHex();
  vote.votes = event.params.votesCast;
  vote.save();
}

export function handleProposalApproval(event: ProposalApprovalEvent): void {
  let proposalId = event.params.proposalHash.toHex();
  let proposal = Proposal.load(proposalId);

  // Proposal approval gets triggered when an application is accepted or a token is added, removed, shares minted, etc in this case
  // the contract does not create a proposal, so to make sure we do not create one by mistake
  // we will check if the voter is a Daoist. This does not seem to make a lot of sense, but if we consider
  // that the only case were we need to create a proposal when handling the approval event is when the
  // Daoist who created the proposal has enough votes to approve it on its own, then if we also consider that
  // the only one that can submit a proposal is a Daoist, then we can tell if we are dealing with an application or not.

  //let submitterId = event.params.voter.toHex();
  //let daoist = Daoist.load(submitterId);
  // && daoist !== null
  // There can be a case where you can directly submit, approve and delete a proposal
  //  without emitting the submission event, check - voteAndContinue()
  if (proposal == null)  {
    proposal = new Proposal(proposalId);
    proposal.submitter = event.params.voter.toHex();

    // create default metaData
    let metaDataId = '0x0000000000000000000000000000000000000000';
    let metaData = new MetaData(metaDataId);
    metaData.title = '';
    metaData.description = '';
    metaData.save();

    proposal.metaData = metaDataId;
    proposal.txHash = event.transaction.hash;
    proposal.index = BigInt.fromI32(0);
    // since the proposal is created and accepeted at the same time, expirationBlock
    // will be the same as the accepted block
    proposal.expirationBlock = event.block.number;;
    proposal.expired = false;
  }
  proposal.acceptedAtBlock = event.block.number;
  proposal.save();

  // get final voter shares
  let exedao = ExeDAO.bind(event.address);
  let voterInfo = exedao.getDaoist(event.params.voter);

  let voteId = event.params.voter.toHex() + '-' + event.params.proposalHash.toHex();
  let vote = new ProposalVote(voteId);
  vote.voter = voterInfo.daoist.toHex();
  vote.proposal = proposalId;
  vote.votes = voterInfo.shares;
  vote.save();
}

export function handleProposalExpiration(event: ProposalExpirationEvent): void {
  let proposalId = event.params.proposalHash.toHex();
  let proposal = Proposal.load(proposalId);
  proposal.expired = true;
  proposal.save();
}

// EXTENSION 

export function handleExtensionAdded(event: ExtensionAddedEvent): void {}

// HELPERS

/*export function processMetaData(value: JSONValue, userData: Value): void {
  log.debug('jsonValue:', [value.toString()]);

  let metaData = new MetaData(userData.toString());
  metaData.title = '';
  metaData.description = '';
  
  let obj = value.toObject();
  let title = obj.get('title').toString();
  let description = obj.get('description').toString();

  metaData.title = title;
  metaData.description = description;
  metaData.save();
}*/

export function fetchMetaData(metaHash: string) : void {
  // 
  let metaData = new MetaData(metaHash);
  metaData.title = '';
  metaData.description = '';

  let hashHex = "1220" + metaHash.slice(2);
  let hashBytes = Bytes.fromHexString(hashHex);
  let hash = hashBytes.toBase58();

  // calling cat prevents the graph from being marked as failed in the case that the file could not be retrived or doesnt exist
  // this is because map either works or breaks the graph, cat supports files as big as 1000kb
  let ipfsFileData = ipfs.cat(hash) as Bytes;
  // Retrieve metaData from ipfs
  // IMPORTANT: The json file MUST be single line formatted to use map. http://jsonlines.org/
  if (ipfsFileData !== null) {
    //ipfs.map(hash, 'processMetaData', Value.fromString(hash), ['json']);
    let jsonData = json.fromBytes(ipfsFileData);
    let obj = jsonData.toObject();
    let title = obj.get('title').toString();
    let description = obj.get('description').toString();

    log.error(
      'title: {}, description: {}',
      [
        title,
        description
      ]
    );
    metaData.title = title;
    metaData.description = description;
  }
  metaData.save();
}