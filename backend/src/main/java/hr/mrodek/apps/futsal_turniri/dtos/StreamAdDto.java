package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One advertisement in the home-page stream ad library.
 *
 * <p>{@code mediaType} is IMAGE or VIDEO; {@code url} is the anonymous-readable
 * MinIO proxy path ({@code /api/resources/<id>/image}) the public banner points
 * an {@code <img>} / {@code <video loop>} at.
 */
public record StreamAdDto(
        Long id,
        String mediaType,
        String url,
        String label,
        String createdAt
) {}
