package hr.mrodek.apps.futsal_turniri.enums;

/**
 * What a paid recording request actually asks for.
 *
 * <p>{@link #FULL_MATCH} is the original product: the video of one whole match.
 * {@link #GOAL} is a single-goal clip, priced far lower - it targets one
 * {@link hr.mrodek.apps.futsal_turniri.model.MatchEvent} of that match.
 *
 * <p>The price carried here is only the DEFAULT applied at creation time; the
 * per-row {@code price_eur_cents} stays authoritative afterwards, so changing a
 * price later never rewrites already-filed requests.
 */
public enum RecordingRequestKind {

    /** Whole match video - 20 EUR. */
    FULL_MATCH(2000),

    /** Clip of one goal - 5 EUR. */
    GOAL(500);

    private final int defaultPriceEurCents;

    RecordingRequestKind(int defaultPriceEurCents) {
        this.defaultPriceEurCents = defaultPriceEurCents;
    }

    public int defaultPriceEurCents() {
        return defaultPriceEurCents;
    }
}
