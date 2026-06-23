package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/** Manually override a single match's kickoff time. */
public record UpdateKickoffRequest(
        OffsetDateTime kickoffAt
) {}
