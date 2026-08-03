package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Badge counts for the /admin console - one number per module card, each
 * counting only rows that are actually waiting on an admin.
 *
 * <p>Field names are Croatian on purpose: they are the frontend contract for
 * the module cards ("Zahtjevi za snimke", "Zahtjevi igrača", "Ponude",
 * "Poruke") and are serialised verbatim, so renaming one silently blanks a
 * badge.
 *
 * @param zahtjeviSnimke MatchRecordingRequest rows in REQUESTED
 * @param zahtjeviIgraci PlayerClaimRequest rows in PENDING
 * @param ponude         camera package inquiries with handled_at IS NULL
 * @param poruke         contact-form messages with handled_at IS NULL
 * @param turniri        tournaments archived on an organizer's deletion
 *                       request, still waiting for the admin to confirm or
 *                       restore ("Upravljanje turnirima")
 */
public record AdminPendingCountsDto(
        long zahtjeviSnimke,
        long zahtjeviIgraci,
        long ponude,
        long poruke,
        long turniri
) {}
