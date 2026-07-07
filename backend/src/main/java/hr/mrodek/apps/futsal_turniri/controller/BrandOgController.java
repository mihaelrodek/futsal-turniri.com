package hr.mrodek.apps.futsal_turniri.controller;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;

/**
 * Branded default OG/social-share image - a 1200×630 "logo + text" card used
 * as the link preview for the whole site (anything that isn't a specific
 * tournament/profile, which have their own images). This is what shows up
 * when someone shares the homepage / a generic page on WhatsApp, Messenger,
 * Facebook, etc.
 *
 * <p>Rendered server-side (Java2D) so there's no static asset to keep in
 * sync with the brand, and cached aggressively since it never changes
 * between deploys.
 *
 * <p>Endpoint: {@code GET /og/default.png}.
 */
@Path("/og")
public class BrandOgController {

    private static final int W = 1200;
    private static final int H = 630;

    private static final Color BG = new Color(0xF3, 0xF6, 0xF1);   // bg.canvas
    private static final Color PITCH = new Color(0x0B, 0x6B, 0x3A); // pitch.500
    private static final Color PITCH_LIGHT = new Color(0x3A, 0xA5, 0x6B);
    private static final Color INK = new Color(0x0E, 0x1F, 0x15);   // fg.ink
    private static final Color WHITE = new Color(0xFF, 0xFF, 0xFF);

    @GET
    @Path("/default.png")
    @Produces("image/png")
    public Response defaultImage() {
        try {
            return Response.ok(render())
                    // Effectively static between deploys - cache for a day.
                    .header("Cache-Control", "public, max-age=86400, s-maxage=86400")
                    .build();
        } catch (Exception e) {
            return Response.serverError().build();
        }
    }

    private byte[] render() throws Exception {
        BufferedImage img = new BufferedImage(W, H, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);

            // Background.
            g.setColor(BG);
            g.fillRect(0, 0, W, H);

            // Soft pitch glow bottom-right.
            g.setColor(new Color(PITCH_LIGHT.getRed(), PITCH_LIGHT.getGreen(), PITCH_LIGHT.getBlue(), 28));
            g.fillOval(W - 420, H - 420, 720, 720);

            // ── Brand mark - green rounded tile with white goal frame + ball.
            int tile = 220;
            int tx = 110;
            int ty = (H - tile) / 2 - 20;
            g.setColor(PITCH);
            g.fill(new RoundRectangle2D.Float(tx, ty, tile, tile, 52, 52));

            // Goal frame (upside-down U) in white.
            g.setColor(WHITE);
            g.setStroke(new BasicStroke(9f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            int gx = tx + 52;
            int gy = ty + 60;
            int gw = tile - 104;
            int gh = tile - 110;
            // left post, crossbar, right post
            g.drawLine(gx, gy + gh, gx, gy);
            g.drawLine(gx, gy, gx + gw, gy);
            g.drawLine(gx + gw, gy, gx + gw, gy + gh);

            // Net hint - faint vertical/horizontal lines inside the frame.
            g.setStroke(new BasicStroke(2f));
            g.setColor(new Color(255, 255, 255, 90));
            for (int i = 1; i < 4; i++) {
                int lx = gx + (gw * i) / 4;
                g.drawLine(lx, gy, lx, gy + gh);
            }
            for (int i = 1; i < 3; i++) {
                int ly = gy + (gh * i) / 3;
                g.drawLine(gx, ly, gx + gw, ly);
            }

            // Ball - white circle with a small green pentagon, bottom-centre.
            int ballR = 40;
            int bcx = tx + tile / 2;
            int bcy = ty + tile - 56;
            g.setColor(WHITE);
            g.fill(new Ellipse2D.Float(bcx - ballR, bcy - ballR, ballR * 2, ballR * 2));
            g.setColor(PITCH);
            int[] px = new int[5];
            int[] py = new int[5];
            for (int i = 0; i < 5; i++) {
                double ang = Math.toRadians(-90 + i * 72);
                px[i] = (int) Math.round(bcx + Math.cos(ang) * (ballR * 0.42));
                py[i] = (int) Math.round(bcy + Math.sin(ang) * (ballR * 0.42));
            }
            g.fillPolygon(px, py, 5);

            // ── Wordmark + domain + tagline.
            int textX = tx + tile + 70;

            g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 22));
            g.setColor(PITCH);
            g.drawString("FUTSAL TURNIRI · HRVATSKA", textX, ty + 36);

            // "Futsal" (ink) + "Turniri" (green) on one baseline.
            Font title = new Font(Font.SANS_SERIF, Font.BOLD, 96);
            g.setFont(title);
            var fm = g.getFontMetrics();
            int baseY = ty + 140;
            g.setColor(INK);
            g.drawString("Futsal ", textX, baseY);
            int futsalW = fm.stringWidth("Futsal ");
            g.setColor(PITCH);
            g.drawString("Turniri", textX + futsalW, baseY);

            // Domain pill.
            g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 26));
            String domain = "futsal-turniri.com";
            int pillW = g.getFontMetrics().stringWidth(domain) + 44;
            int pillH = 48;
            int pillY = baseY + 28;
            g.setColor(PITCH);
            g.fill(new RoundRectangle2D.Float(textX, pillY, pillW, pillH, pillH, pillH));
            g.setColor(WHITE);
            g.drawString(domain, textX + 22, pillY + 33);

            // Tagline.
            g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 30));
            g.setColor(new Color(INK.getRed(), INK.getGreen(), INK.getBlue(), 200));
            g.drawString("Organiziraj i prati futsal turnire.", textX, pillY + pillH + 56);
        } finally {
            g.dispose();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }
}
