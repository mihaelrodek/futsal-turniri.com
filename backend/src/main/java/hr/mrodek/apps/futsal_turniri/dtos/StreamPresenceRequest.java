package hr.mrodek.apps.futsal_turniri.dtos;

/** Heartbeat body from a stream viewer: a random, per-tab session id. */
public record StreamPresenceRequest(String sessionId) {}
