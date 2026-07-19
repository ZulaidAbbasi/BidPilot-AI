/**
 * Pure derivations of the runtime call authority block from the confirmed
 * specification's `agent_permissions`. This is the single source of truth
 * used by `load-call-context` when telling the Provider Agent what it may
 * and may not do. Extracted from the route so it can be unit-tested against
 * the challenge invariants:
 *
 *   - may_use_verified_leverage=false  → leverage never delivered
 *   - may_accept_offer=false           → cannot represent as accepted
 *   - may_sign_or_authorize=false      → cannot book the move
 *   - may_change_inventory=false       → cannot approve scope changes
 *   - may_reveal_max_budget=false      → cannot disclose budget
 *
 * The prompt alone is not sufficient; every gate in this module MUST be
 * mirrored by real server-side enforcement in the tool endpoints.
 */

export type CallMode = "QUOTE_GATHERING" | "NEGOTIATION";

export interface AgentPermissionsInput {
  may_request_quote?: boolean;
  may_request_itemization?: boolean;
  may_negotiate_price?: boolean;
  may_request_fee_waivers?: boolean;
  may_request_improved_terms?: boolean;
  may_use_verified_leverage?: boolean;
  may_request_written_estimates?: boolean;
  may_accept_offer?: boolean;
  may_pay_deposit?: boolean;
  may_change_inventory?: boolean;
  may_add_paid_services?: boolean;
  may_reveal_max_budget?: boolean;
  may_sign_or_authorize?: boolean;
}

export interface CallAuthorityBlock {
  call_mode: CallMode;
  allowed_actions: {
    request_quote: boolean;
    request_itemization: boolean;
    negotiate_price: boolean;
    request_fee_waivers: boolean;
    request_improved_terms: boolean;
    use_verified_leverage: boolean;
    request_written_estimates: boolean;
  };
  forbidden_actions: {
    accept_offer: boolean;
    pay_deposit: boolean;
    change_inventory: boolean;
    add_paid_services: boolean;
    reveal_max_budget: boolean;
    sign_or_authorize: boolean;
    mention_competing_quote: boolean;
    invent_leverage: boolean;
    switch_call_mode: boolean;
    use_verified_leverage: boolean;
  };
  can_accept_quote: boolean;
  can_book: boolean;
  requires_human_approval: true;
  notes: string;
}

export interface DeriveArgs {
  callMode: CallMode;
  perms: AgentPermissionsInput | null | undefined;
  /**
   * Whether an eligible bound leverage quote was actually resolved. This
   * has already been filtered by permission upstream; when the customer
   * revoked leverage authority callers MUST pass `false` here.
   */
  leverageAvailable: boolean;
}

const DEFAULTS: Required<AgentPermissionsInput> = {
  may_request_quote: true,
  may_request_itemization: true,
  may_negotiate_price: true,
  may_request_fee_waivers: true,
  may_request_improved_terms: true,
  may_use_verified_leverage: true,
  may_request_written_estimates: true,
  may_accept_offer: false,
  may_pay_deposit: false,
  may_change_inventory: false,
  may_add_paid_services: false,
  may_reveal_max_budget: false,
  may_sign_or_authorize: false,
};

function resolve(perms: AgentPermissionsInput | null | undefined): Required<AgentPermissionsInput> {
  return { ...DEFAULTS, ...(perms ?? {}) };
}

/**
 * True when the customer has NOT revoked leverage authority. Callers must
 * treat a `false` result as an authority-level ban that always beats the
 * eligibility check — the challenge requires that a revoked permission
 * prevents leverage delivery even for otherwise-verifiable offers.
 */
export function isLeverageAuthorized(perms: AgentPermissionsInput | null | undefined): boolean {
  return resolve(perms).may_use_verified_leverage === true;
}

export function deriveCallAuthority(args: DeriveArgs): CallAuthorityBlock {
  const p = resolve(args.perms);
  const { callMode, leverageAvailable } = args;

  const negotiateAllowed = callMode === "NEGOTIATION" && p.may_negotiate_price;
  const useLeverageAllowed =
    callMode === "NEGOTIATION" && p.may_use_verified_leverage && leverageAvailable;

  let notes: string;
  if (callMode === "QUOTE_GATHERING") {
    notes =
      "QUOTE_GATHERING mode: gather the provider's own quote only. You MUST NOT mention any competing offer, cite leverage, negotiate on price, or reference another provider. All commitments require human approval.";
  } else if (!p.may_use_verified_leverage) {
    notes =
      "NEGOTIATION mode but customer has REVOKED leverage authority. Do not cite any competing quote. Ask for concessions on scope, guarantees, and terms only.";
  } else if (leverageAvailable) {
    notes =
      "NEGOTIATION mode with verified leverage: you may cite ONLY the exact verified stored offer returned by this tool. Do not round, adjust, or restate the amount differently. Do not cite any other competitor. Do not commit to signing, deposits, or scheduling.";
  } else {
    notes =
      "NEGOTIATION mode WITHOUT verified leverage: do not invent a competing quote, do not claim verified leverage exists. Gather or confirm the provider's current offer, and finalize truthfully if a leverage-based negotiation cannot proceed. Do not commit to signing, deposits, or scheduling.";
  }

  return {
    call_mode: callMode,
    allowed_actions: {
      request_quote: p.may_request_quote,
      request_itemization: p.may_request_itemization,
      negotiate_price: negotiateAllowed,
      request_fee_waivers: p.may_request_fee_waivers,
      request_improved_terms: p.may_request_improved_terms,
      use_verified_leverage: useLeverageAllowed,
      request_written_estimates: p.may_request_written_estimates,
    },
    forbidden_actions: {
      accept_offer: !p.may_accept_offer,
      pay_deposit: !p.may_pay_deposit,
      change_inventory: !p.may_change_inventory,
      add_paid_services: !p.may_add_paid_services,
      reveal_max_budget: !p.may_reveal_max_budget,
      sign_or_authorize: !p.may_sign_or_authorize,
      mention_competing_quote: callMode === "QUOTE_GATHERING" || !p.may_use_verified_leverage,
      invent_leverage: true,
      switch_call_mode: true,
      // Explicit mirror so the agent gets a hard "no" when the customer
      // revoked leverage authority even in NEGOTIATION mode.
      use_verified_leverage: !useLeverageAllowed,
    },
    can_accept_quote: p.may_accept_offer,
    can_book: p.may_sign_or_authorize,
    requires_human_approval: true,
    notes,
  };
}
