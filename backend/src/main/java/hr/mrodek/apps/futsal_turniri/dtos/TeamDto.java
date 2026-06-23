package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TeamDto(
        Integer id,

        @NotBlank(message = "team name is required")
        @Size(max = 200, message = "team name must be at most 200 characters")
        String name,

        Boolean isEliminated,

        String submittedByUid,
        Boolean pendingApproval,

        // Display info about the submitter — populated from UserProfile when
        // the controller enriches via TeamMapper.toDtoListEnriched. Null when
        // the team was added by an organizer (no submittedByUid).
        String submittedBySlug,
        String submittedByName,

        // Co-owner who claimed the team via the share link. Same enrichment
        // approach: UID is the source-of-truth column, slug + display name
        // are looked up from UserProfile per request.
        String coSubmittedByUid,
        String coSubmittedBySlug,
        String coSubmittedByName,

        // Opaque token that goes in the /claim-team/{token} URL. Only sent
        // to the primary submitter and to organizers/admins — viewers who
        // shouldn't see the share link get null here.
        String claimToken
) {
    /** Backwards-compat constructor for callers that don't yet enrich submitter info. */
    public TeamDto(
            Integer id, String name, Boolean isEliminated,
            String submittedByUid, Boolean pendingApproval
    ) {
        this(id, name, isEliminated,
                submittedByUid, pendingApproval, null, null,
                null, null, null, null);
    }

    /** Earlier constructor without co-owner / token fields. */
    public TeamDto(
            Integer id, String name, Boolean isEliminated,
            String submittedByUid, Boolean pendingApproval,
            String submittedBySlug, String submittedByName
    ) {
        this(id, name, isEliminated,
                submittedByUid, pendingApproval, submittedBySlug, submittedByName,
                null, null, null, null);
    }
}
