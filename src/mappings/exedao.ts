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

import { log, BigInt, Bytes, Address, ipfs, JSONValue, Value } from '@graphprotocol/graph-ts';

// APPLICATION
export function handleApplicationAdded(event : ApplicationAddedEvent) : void {
  // overwrite previous canceled application or initialize new one
  let applicationId = event.params.applicant.toHex();
  let application = new Application(applicationId);
  application.tokenTributes = [];
  application.tokenTributeValues = [];
  //application.metaHash = BigInt.fromI32(0);
  application.canceledAtBlock = BigInt.fromI32(0);

  // get full application info from contract
  let exedao = ExeDAO.bind(event.address);
  let applicationInfo = exedao.getApplication(event.params.applicant);
  application.shares = applicationInfo.shares;
  application.metaHash = applicationInfo.metaHash;
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
  //let hash = applicationInfo.metaHash.toHex();
  //fetchMetaData(hash);
  application.save();
}

export function handleApplicationCanceled(event : ApplicationCanceledEvent) : void {
  let applicationId = event.params.applicant.toHex();
  let application = Application.load(applicationId);
  application.canceledAtBlock = event.block.number;
  application.save();
}

// DAOIST

export function handleSharesMinted(event : SharesMintedEvent) : void {
  let daoistId = event.params.daoist.toHex();
  let daoist = Daoist.load(daoistId);
  // New Daoist ?
  if (daoist) {
    daoist.shares = daoist.shares.plus(event.params.shares);
  } else {
    daoist = new Daoist(daoistId);
    daoist.shares = event.params.shares;
    let application = Application.load(daoistId);
    // the deployer of the contract is a daoist without application.
    if (application) {
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
  // add ERC20 contract indexing
  ERC20Template.create(event.params.tokenAddress);
  
  let tokenId = event.params.tokenAddress.toHex();
  let token = new Token(tokenId);
  token.admitted = true;
  token.balance = BigInt.fromI32(0);
  token.name = "Unnamed ERC20";
  token.symbol = 'ERC20';
  token.decimals = BigInt.fromI32(18);

  // try to fetch optional fields (ONLY RELIABLE WHEN CONNECTED TO A PARITY CLIENT)
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

export function handleProposalSubmission(event : ProposalSubmissionEvent) : void {
  // the submitter also votes the proposal on creation.
  let voteId = event.params.submitter.toHex() + '-' + event.params.proposalHash.toHex();
  let vote = new ProposalVote(voteId);
  vote.voter = event.params.submitter;
  vote.proposalHash = event.params.proposalHash;
  vote.votes = event.params.votesCast;
  vote.save();

  let proposalId = event.params.proposalHash.toHex();
  let proposal = new Proposal(proposalId);
  proposal.votes = [];
  // this step might seem weird but remember that push() returns the new length of the array.
  let votes = proposal.votes;
  votes.push(voteId);
  proposal.votes = votes;
  
  // fetch extra proposal info not contained in the event.
  let exedao = ExeDAO.bind(event.address);
  let proposalInfo = exedao.getProposal(event.params.proposalHash);
  proposal.submitter = event.params.submitter;
  proposal.metaHash = proposalInfo.metaHash;
  proposal.txHash = event.transaction.hash;
  proposal.index = proposalInfo.proposalIndex;
  proposal.expirationBlock = proposalInfo.expiryBlock;
  proposal.acceptedAtBlock = BigInt.fromI32(0);
  proposal.expired = false;

  // IPFS resolve
  //let hash = proposalInfo.metaHash.toHex();
  //fetchMetaData(hash);

  proposal.save();
}

export function handleProposalVote(event : ProposalVoteEvent) : void {
  let voteId = event.params.voter.toHex() + '-' + event.params.proposalHash.toHex();
  let vote = new ProposalVote(voteId);
  vote.voter = event.params.voter;
  vote.proposalHash = event.params.proposalHash;
  vote.votes = event.params.votesCast;
  vote.save();

  let proposalId = event.params.proposalHash.toHex();
  let proposal = Proposal.load(proposalId);
  let votes = proposal.votes;
  votes.push(voteId);
  proposal.votes = votes;
  proposal.save();
}

export function handleProposalApproval(event: ProposalApprovalEvent): void {
  // get final voter shares
  let exedao = ExeDAO.bind(event.address);
  let voterInfo = exedao.getDaoist(event.params.voter);

  let voteId = event.params.voter.toHex() + '-' + event.params.proposalHash.toHex();
  let vote = new ProposalVote(voteId);
  vote.voter = event.params.voter;
  vote.proposalHash = event.params.proposalHash;
  vote.votes = voterInfo.shares;
  vote.save();

  let proposalId = event.params.proposalHash.toHex();
  let proposal = Proposal.load(proposalId);
  proposal.acceptedAtBlock = event.block.number;
  let votes = proposal.votes;
  votes.push(voteId);
  proposal.votes = votes;
  proposal.save();
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

export function processMetaData(value: JSONValue, userData: Value): void {
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
}

export function fetchMetaData(metaHash: string) : void {
  let hashHex = "1220" + metaHash.slice(2);
  let hashBytes = Bytes.fromHexString(hashHex);
  let hash = hashBytes.toBase58();

  // calling cat prevents the graph from being marked as failed in the case that the file could not be retrived or doesnt exist
  // on the other hand, it also adds an extra call, this is because map either works or breaks the graph
  // if you ask yourself why are we using map then? its because some files might be too big for cat (potentially extensions)
  let exists = ipfs.cat(hash);
  // Retrieve metaData from ipfs
  // IMPORTANT: The json file MUST be single line formatted. http://jsonlines.org/
  if (exists !== null) {
    ipfs.map(hash, 'processMetaData', Value.fromString(hash), ['json']);
  }
}