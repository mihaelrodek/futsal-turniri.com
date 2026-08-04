package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * One filled-in team registration form.
 *
 * <p>Used by both entry points, which differ only in who is allowed to POST
 * them: the signed-in self-registration
 * ({@code POST /tournaments/{uuid}/teams/self-register}) and the public
 * link-based one ({@code POST /registration/{token}}). Sharing the shape is
 * the point - the organizer must not be able to tell from the resulting team
 * row which door it came through, beyond the contact fields an anonymous
 * submitter has to supply.
 *
 * <p>Everything except {@code teamName} is optional. A club that only knows
 * its name at signup time must be able to register, and the roster and kit are
 * editable by the organizer afterwards anyway.
 *
 * @param players   roster; each entry may carry a number and the captain /
 *                  goalkeeper marks. Ignored entries with a blank name are
 *                  dropped rather than rejected - a form with three empty rows
 *                  at the bottom is the normal case, not an error.
 */
public record TeamRegistrationRequest(
        @NotBlank(message = "name is required")
        @Size(max = 200, message = "name must be at most 200 characters")
        String teamName,

        /** Lowercase {@code #rrggbb}; anything else is ignored by the controller. */
        @Size(max = 9) String jerseyColor,
        @Size(max = 9) String shortsColor,

        /** Who is filing this - required by the public endpoint, ignored by the
         *  signed-in one (the account is the identity there). */
        @Size(max = 200) String contactName,
        @Size(max = 200) String contact,

        @Size(max = 1000) String note,

        @Valid List<RegistrationPlayer> players
) {

    /** One roster line in the form. */
    public record RegistrationPlayer(
            @Size(max = 200) String name,
            Integer number,
            Boolean captain,
            Boolean goalkeeper
    ) {}
}
