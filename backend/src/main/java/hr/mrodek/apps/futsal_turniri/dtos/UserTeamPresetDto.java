package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Viewer-aware preset row. Same preset can be viewed by either the
 * primary submitter or the claimed co-owner - fields are framed
 * relative to "you" (the viewer) and "your partner" so the frontend
 * doesn't need to translate role names.
 */
public record UserTeamPresetDto(
        UUID uuid,

        @NotBlank(message = "name is required")
        @Size(max = 200, message = "name must be at most 200 characters")
        String name,

        Boolean hidden,

        /** "PRIMARY" if the viewer is the original creator of the preset, "CO_OWNER" otherwise. */
        String myRole,

        /** The other owner's display info - null until the preset is claimed. */
        String partnerSlug,
        String partnerName,

        /** Share token - only emitted to the primary when the preset is unclaimed. */
        String claimToken,

        /** True if there's a pending archive request that THIS viewer filed. */
        Boolean archiveRequestedByMe,
        /** True if there's a pending archive request that the PARTNER filed (awaiting my response). */
        Boolean archiveRequestedByPartner
) {
    /** 2-arg shim used by older callers that just need uuid + name. */
    public UserTeamPresetDto(UUID uuid, String name) {
        this(uuid, name, Boolean.FALSE, "PRIMARY", null, null, null, Boolean.FALSE, Boolean.FALSE);
    }

    /** 3-arg shim with hidden. */
    public UserTeamPresetDto(UUID uuid, String name, Boolean hidden) {
        this(uuid, name, hidden, "PRIMARY", null, null, null, Boolean.FALSE, Boolean.FALSE);
    }

    /** 6-arg shim used by the pre-archive controller. */
    public UserTeamPresetDto(
            UUID uuid, String name, Boolean hidden,
            String coOwnerSlug, String coOwnerName, String claimToken
    ) {
        this(uuid, name, hidden, "PRIMARY", coOwnerSlug, coOwnerName, claimToken, Boolean.FALSE, Boolean.FALSE);
    }
}
