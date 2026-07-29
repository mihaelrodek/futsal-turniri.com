package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * Renders the 1200×630 PNG share card for a tournament. Pure-function
 * style (no CDI) so it can be called from anywhere - the only state is
 * its constants. The endpoint that exposes this lives in
 * {@code TournamentController#shareImage} to keep the {@code @Path("/tournaments")}
 * root owned by a single resource class (a second resource class
 * historically broke RESTEasy's path matching).
 */
public final class ShareImageRenderer {

    private static final int WIDTH = 1200;
    private static final int HEIGHT = 630;

    private static final Color BG_TOP = new Color(0x0A, 0x16, 0x10);
    private static final Color BG_BOT = new Color(0x0E, 0x1F, 0x15);
    private static final Color PITCH = new Color(0x36, 0xB3, 0x70);
    private static final Color WHITE = new Color(0xFA, 0xFA, 0xFA);
    private static final Color WHITE_MUTED = new Color(0xFA, 0xFA, 0xFA, 180);
    private static final Color WHITE_FAINT = new Color(0xFA, 0xFA, 0xFA, 100);
    private static final Color GOLD = new Color(0xF6, 0xC3, 0x4A);
    private static final Color SILVER = new Color(0xC9, 0xCE, 0xD6);
    private static final Color BRONZE = new Color(0xCD, 0x7F, 0x32);

    private ShareImageRenderer() {}

    public static byte[] render(Tournaments t) throws Exception {
        BufferedImage img = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);

            // Vertical gradient background - rows of single-color rects
            // avoid relying on GradientPaint subpixel rounding.
            for (int y = 0; y < HEIGHT; y++) {
                float ratio = (float) y / HEIGHT;
                int r = lerp(BG_TOP.getRed(), BG_BOT.getRed(), ratio);
                int gg = lerp(BG_TOP.getGreen(), BG_BOT.getGreen(), ratio);
                int b = lerp(BG_TOP.getBlue(), BG_BOT.getBlue(), ratio);
                g.setColor(new Color(r, gg, b));
                g.fillRect(0, y, WIDTH, 1);
            }

            // Soft pitch-green glow in the bottom-right.
            g.setColor(new Color(PITCH.getRed(), PITCH.getGreen(), PITCH.getBlue(), 36));
            g.fillOval(WIDTH - 480, HEIGHT - 480, 800, 800);

            // Brand bar.
            g.setColor(PITCH);
            g.fillRect(0, 0, 12, HEIGHT);

            // Mono kicker.
            Font monoSm = new Font(Font.MONOSPACED, Font.BOLD, 18);
            g.setFont(monoSm);
            g.setColor(PITCH);
            g.drawString("FUTSAL TURNIRI · HRVATSKA", 60, 80);

            drawStatusPill(g, t.getStatus());

            // Title - large, wrapped at column width 1000. Capped at 2 lines
            // (ellipsized beyond that) so a very long name can never push the
            // meta row/podium further down than the fixed layout below
            // expects - see the overlap bug this fixed.
            String name = safe(t.getName(), "Turnir");
            int titleY = 180;
            Font titleFont = new Font(Font.SANS_SERIF, Font.BOLD, 70);
            g.setColor(WHITE);
            titleY = drawWrapped(g, name, 60, titleY, 1000, titleFont, 78, 2);

            // Date + location row.
            g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 28));
            g.setColor(WHITE_MUTED);
            String dateStr = formatDate(t.getStartAt());
            String loc = safe(t.getLocation(), "");
            String meta = loc.isBlank() ? dateStr : dateStr + " · " + loc;
            int metaY = titleY + 24;
            g.drawString(truncate(g, meta, 1000), 60, metaY);

            if (t.getStatus() == TournamentStatus.FINISHED && hasContent(t.getWinnerName())) {
                drawPodium(g, metaY, t.getWinnerName(), t.getSecondPlaceName(), t.getThirdPlaceName());
            } else if (t.getStatus() == TournamentStatus.STARTED) {
                drawLiveBadge(g, metaY);
            }

            g.setFont(monoSm);
            g.setColor(WHITE_FAINT);
            g.drawString("FUTSAL-TURNIRI.COM", 60, HEIGHT - 36);
        } finally {
            g.dispose();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }

    private static void drawStatusPill(Graphics2D g, TournamentStatus status) {
        if (status == null) return;
        String label;
        Color fg;
        Color bg;
        switch (status) {
            case FINISHED -> { label = "ZAVRŠENO"; fg = PITCH; bg = new Color(PITCH.getRed(), PITCH.getGreen(), PITCH.getBlue(), 40); }
            case STARTED -> { label = "U TIJEKU"; fg = new Color(0xE5, 0x3E, 0x3E); bg = new Color(0xE5, 0x3E, 0x3E, 40); }
            case DRAFT -> { label = "USKORO"; fg = WHITE; bg = new Color(0xFA, 0xFA, 0xFA, 28); }
            default -> { label = status.name(); fg = WHITE; bg = new Color(0xFA, 0xFA, 0xFA, 28); }
        }
        Font f = new Font(Font.MONOSPACED, Font.BOLD, 16);
        g.setFont(f);
        int w = g.getFontMetrics().stringWidth(label) + 36;
        int h = 38;
        int x = WIDTH - 60 - w;
        int y = 56;
        g.setColor(bg);
        g.fill(new RoundRectangle2D.Float(x, y, w, h, 28, 28));
        g.setColor(fg);
        g.drawString(label, x + 18, y + 25);
    }

    private static void drawPodium(Graphics2D g, int metaY, String first, String second, String third) {
        // 360 is the default that fits a 1-2 line title; metaY + 40 is a
        // floor so a taller title (still capped at 2 lines) never overlaps.
        int baseY = Math.max(360, metaY + 40);
        int colW = 320;
        int gap = 32;
        int totalW = colW * 3 + gap * 2;
        int startX = (WIDTH - totalW) / 2;

        drawPodiumCard(g, startX, baseY - 40, colW, "1.", first, GOLD, 220);
        if (hasContent(second)) {
            drawPodiumCard(g, startX + colW + gap, baseY, colW, "2.", second, SILVER, 180);
        }
        if (hasContent(third)) {
            drawPodiumCard(g, startX + (colW + gap) * 2, baseY + 20, colW, "3.", third, BRONZE, 160);
        }
    }

    private static void drawPodiumCard(Graphics2D g, int x, int y, int w, String rank, String name, Color accent, int h) {
        g.setColor(new Color(0xFA, 0xFA, 0xFA, 16));
        g.fill(new RoundRectangle2D.Float(x, y, w, h, 24, 24));
        g.setColor(accent);
        g.fillRect(x, y, w, 6);

        g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 22));
        g.setColor(accent);
        g.drawString(rank, x + 24, y + 50);

        g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 36));
        g.setColor(accent);
        g.drawString("★", x + w - 60, y + 56);

        g.setColor(WHITE);
        // Capped at 2 lines too - a long team name shouldn't be able to
        // grow the card past its fixed height (160-220px).
        drawWrapped(g, safe(name, "-"), x + 24, y + 100, w - 48,
                new Font(Font.SANS_SERIF, Font.BOLD, 32), 38, 2);
    }

    private static void drawLiveBadge(Graphics2D g, int metaY) {
        int x = 60;
        int y = Math.max(380, metaY + 60);
        int w = 360;
        int h = 120;
        Color red = new Color(0xDC, 0x26, 0x26);
        g.setColor(new Color(red.getRed(), red.getGreen(), red.getBlue(), 30));
        g.fill(new RoundRectangle2D.Float(x, y, w, h, 20, 20));
        g.setColor(red);
        g.fillRect(x, y, 6, h);

        g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 24));
        g.drawString("U TIJEKU", x + 32, y + 50);
        g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 36));
        g.setColor(WHITE);
        g.drawString("Turnir u tijeku", x + 32, y + 96);
    }

    private static int lerp(int a, int b, float t) {
        return Math.round(a + (b - a) * t);
    }

    /** Greedy word-wrap capped at {@code maxLines} - text beyond that is
     *  ellipsized onto the last line instead of growing the layout further
     *  down (this is what fixed titles overlapping the podium/meta row). */
    private static int drawWrapped(Graphics2D g, String text, int x, int y, int maxWidth, Font font, int lineHeight, int maxLines) {
        g.setFont(font);
        var fm = g.getFontMetrics();
        String[] words = text.split("\\s+");
        java.util.List<String> lines = new java.util.ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String w : words) {
            String candidate = line.length() == 0 ? w : line + " " + w;
            if (fm.stringWidth(candidate) <= maxWidth) {
                line = new StringBuilder(candidate);
            } else {
                if (line.length() > 0) lines.add(line.toString());
                line = new StringBuilder(w);
            }
        }
        if (line.length() > 0) lines.add(line.toString());

        boolean overflow = lines.size() > maxLines;
        int drawCount = Math.min(lines.size(), maxLines);
        int yy = y;
        for (int i = 0; i < drawCount; i++) {
            boolean isLastDrawn = i == drawCount - 1;
            String lineText = isLastDrawn && overflow ? ellipsize(g, lines.get(i), maxWidth) : lines.get(i);
            g.drawString(lineText, x, yy);
            if (!isLastDrawn) yy += lineHeight;
        }
        return yy;
    }

    private static String truncate(Graphics2D g, String s, int maxWidth) {
        var fm = g.getFontMetrics();
        if (fm.stringWidth(s) <= maxWidth) return s;
        return ellipsize(g, s, maxWidth);
    }

    /** Appends "…", trimming characters from the end until it fits - unlike
     *  {@link #truncate}, always adds the ellipsis even if {@code s} itself
     *  already fits (used when more text follows that we're dropping). */
    private static String ellipsize(Graphics2D g, String s, int maxWidth) {
        var fm = g.getFontMetrics();
        String ellipsis = "…";
        if (fm.stringWidth(s + ellipsis) <= maxWidth) return s + ellipsis;
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (fm.stringWidth(b + ellipsis + c) > maxWidth) break;
            b.append(c);
        }
        return b + ellipsis;
    }

    private static String safe(String s, String fallback) {
        return (s == null || s.isBlank()) ? fallback : s;
    }

    private static boolean hasContent(String s) {
        return s != null && !s.isBlank();
    }

    private static String formatDate(OffsetDateTime dt) {
        if (dt == null) return "";
        return dt.format(DateTimeFormatter.ofPattern("d. M. yyyy.", new Locale("hr")));
    }
}
