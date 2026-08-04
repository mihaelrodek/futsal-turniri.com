package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.TournamentRegistrationLink;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@ApplicationScoped
public class TournamentRegistrationLinkRepository
        implements AppRepository<TournamentRegistrationLink, Long> {

    /**
     * Lookup behind the PUBLIC registration form. The token is the capability,
     * so this is the only query here reachable without authentication - and it
     * deliberately does NOT filter on {@code active}: the controller has to
     * tell "no such link" apart from "revoked" to say something useful, while
     * still answering both with the same status code.
     */
    public Optional<TournamentRegistrationLink> findByToken(UUID token) {
        if (token == null) return Optional.empty();
        return find("token", token).firstResultOptional();
    }

    /** Every link an organizer made for one tournament, newest first. */
    public List<TournamentRegistrationLink> findByTournamentId(Long tournamentId) {
        return list("tournament.id", Sort.by("createdAt").descending(), tournamentId);
    }
}
