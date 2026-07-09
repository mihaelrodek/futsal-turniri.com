import { NotFoundView } from "frontend"

/** The router catch-all — big mono 404, rolling futsal ball, and the two recovery CTAs. */
export function Default() {
    return (
        <div style={{ width: "100%", maxWidth: 620 }}>
            <NotFoundView />
        </div>
    )
}

/** Re-used on detail pages whose entity vanished — custom code, title and copy for a deleted tournament. */
export function DeletedTournament() {
    return (
        <div style={{ width: "100%", maxWidth: 620 }}>
            <NotFoundView
                code="404"
                title="Turnir nije pronađen"
                description="Ovaj turnir je obrisan ili poveznica više ne vrijedi."
            />
        </div>
    )
}
