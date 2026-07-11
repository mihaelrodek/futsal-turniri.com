package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body of PUT /tournaments/{uuid}/scorer-scope - which goals count toward the
 * best-scorer race. One of the {@link hr.mrodek.apps.futsal_turniri.enums.ScorerScope}
 * names: ALL | KNOCKOUT | ROUND_OF_32 | ROUND_OF_16 | QUARTERFINAL | SEMIFINAL.
 */
public record ScorerScopeRequest(String scope) {}
