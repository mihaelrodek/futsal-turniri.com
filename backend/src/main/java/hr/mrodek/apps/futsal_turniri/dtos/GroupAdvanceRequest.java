package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Set a group's per-group advance override.
 * {@code advanceCount == null} clears the override (group falls back to the
 * tournament's uniform advancePerGroup). Otherwise it is clamped to the group
 * size server-side.
 */
public record GroupAdvanceRequest(
        @Min(1) @Max(64) Integer advanceCount
) {}
