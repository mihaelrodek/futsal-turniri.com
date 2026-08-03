// src/types/players.ts
/**
 * A single player on a team's roster. New backend feature - see
 * src/api/players.ts for the endpoint contract.
 */
export type PlayerDto = {
    id: number;
    name: string;
    /** Jersey number, or null when unset. */
    number: number | null;
    /** At most one player per team is the captain. */
    captain: boolean;
    /** Goalkeeper mark ("GK"). Independent of `captain` and NOT limited to one
     *  per team - a roster may carry a backup keeper. */
    goalkeeper: boolean;
};
