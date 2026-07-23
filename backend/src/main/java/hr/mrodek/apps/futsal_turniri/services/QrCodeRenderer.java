package hr.mrodek.apps.futsal_turniri.services;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.GeneralPath;
import java.awt.geom.Line2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.EnumMap;
import java.util.Map;

/**
 * Renders a tournament's share-link as a branded PNG QR code.
 *
 * <p>The QR encodes the public tournament URL, so scanning it opens the
 * tournament page. Error-correction level H (~30% recovery) lets us punch
 * the futsal-turniri brand mark into the centre without breaking
 * scannability. Pure Java2D over a ZXing BitMatrix - no extra image libs.
 */
public final class QrCodeRenderer {

    private static final Color FG = new Color(0x0E, 0x1F, 0x15); // near-black ink
    private static final Color BG = Color.WHITE;
    private static final Color TILE = new Color(0xED, 0xF0, 0xF3); // light badge tile
    private static final Color TEAL = new Color(0x17, 0xA7, 0x9D); // brand teal (pitch.500)
    private static final Color TEAL_GRID = new Color(0x17, 0xA7, 0x9D, 153); // teal @ 60% (net grid)
    private static final Color WHITE = Color.WHITE;

    // The brand mark in the logo's 112x112 coordinate space (identical paths to
    // public/logo/mark-green.svg), so the QR centre draws the SAME detailed goal
    // net + futsal ball as the in-app logo, not a simplified stand-in.
    private static final int[] GRID_V = {42, 54, 66, 78};       // vertical net lines (u)
    private static final int[] GRID_H = {50, 62, 74};           // horizontal net lines (v)
    // Ball (nested svg x=39 y=60 w=34 h=34, internal viewBox 0..100).
    private static final float[][] BALL_CENTRE_PENTAGON =
            {{50, 34}, {65.22f, 45.06f}, {59.41f, 62.94f}, {40.59f, 62.94f}, {34.78f, 45.06f}};
    private static final float[][] BALL_OUTER_PENTAGON =
            {{61.41f, 85.71f}, {50, 94}, {38.59f, 85.71f}, {42.95f, 72.29f}, {57.05f, 72.29f}};

    private QrCodeRenderer() {}

    /** PNG bytes for a {@code size}×{@code size} branded QR encoding {@code url}. */
    public static byte[] render(String url, int size) throws Exception {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.H);
        hints.put(EncodeHintType.MARGIN, 1);
        hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");

        BitMatrix matrix = new QRCodeWriter()
                .encode(url, BarcodeFormat.QR_CODE, size, size, hints);

        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            // White background.
            g.setColor(BG);
            g.fillRect(0, 0, size, size);
            // Black modules.
            g.setColor(FG);
            for (int y = 0; y < size; y++) {
                for (int x = 0; x < size; x++) {
                    if (matrix.get(x, y)) g.fillRect(x, y, 1, 1);
                }
            }
            drawCenterMark(g, size);
        } finally {
            g.dispose();
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }

    /**
     * Brand mark in the centre: a white rounded "knockout" of ~24% of the QR,
     * then the light tile with the SAME detailed teal goal (net grid + frame)
     * and futsal ball (centre + five outer pentagons) as the in-app Logo / app
     * icon - not a simplified stand-in. Every path is the logo's 112-space
     * geometry mapped into the tile. EC-H means the obscured centre modules are
     * recoverable, so scannability is preserved.
     */
    private static void drawCenterMark(Graphics2D g, int size) {
        int markSize = Math.round(size * 0.24f);
        int x = (size - markSize) / 2;
        int y = (size - markSize) / 2;

        // White padding knockout behind the tile so the QR reads cleanly.
        int pad = Math.round(markSize * 0.16f);
        g.setColor(WHITE);
        g.fill(new RoundRectangle2D.Float(
                x - pad, y - pad, markSize + 2f * pad, markSize + 2f * pad,
                markSize * 0.35f, markSize * 0.35f));

        // Light rounded tile.
        g.setColor(TILE);
        g.fill(new RoundRectangle2D.Float(x, y, markSize, markSize, markSize * 0.28f, markSize * 0.28f));

        // k maps the logo's 112-unit space to device px; (x,y) is its origin.
        float k = markSize / 112f;

        // Goal net grid - teal at 60%, thin.
        g.setColor(TEAL_GRID);
        g.setStroke(new BasicStroke(Math.max(0.8f, 1f * k)));
        for (int u : GRID_V) g.draw(new Line2D.Float(x + u * k, y + 38 * k, x + u * k, y + 82 * k));
        for (int v : GRID_H) g.draw(new Line2D.Float(x + 30 * k, y + v * k, x + 82 * k, y + v * k));

        // Goal frame: M30 82 V38 H82 V82.
        g.setColor(TEAL);
        g.setStroke(new BasicStroke(Math.max(2f, 3.6f * k), BasicStroke.CAP_BUTT, BasicStroke.JOIN_ROUND));
        GeneralPath frame = new GeneralPath();
        frame.moveTo(x + 30 * k, y + 82 * k);
        frame.lineTo(x + 30 * k, y + 38 * k);
        frame.lineTo(x + 82 * k, y + 38 * k);
        frame.lineTo(x + 82 * k, y + 82 * k);
        g.draw(frame);

        // Futsal ball. The nested svg sits at u=39,v=60 (112-space), 34 wide,
        // internal viewBox 0..100 -> one internal unit = 0.34*k device px.
        float bScale = 0.34f * k;
        float bx = x + 39 * k;   // device origin of internal (0,0)
        float by = y + 60 * k;
        float bcx = bx + 50 * bScale, bcy = by + 50 * bScale, br = 46 * bScale;
        Ellipse2D.Float ball = new Ellipse2D.Float(bcx - br, bcy - br, br * 2, br * 2);
        g.setColor(WHITE);
        g.fill(ball);
        g.setColor(TEAL);
        g.setStroke(new BasicStroke(Math.max(1.2f, 2.6f * bScale), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.draw(ball);

        // Seam spokes: M50,33 L50,7 rotated 0/72/144/216/288 about (50,50).
        g.setStroke(new BasicStroke(Math.max(1f, 2.3f * bScale), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (int r = 0; r < 5; r++) {
            double a = Math.toRadians(r * 72);
            double[] p1 = rotate(50, 33, a);
            double[] p2 = rotate(50, 7, a);
            g.draw(new Line2D.Float(
                    bx + (float) p1[0] * bScale, by + (float) p1[1] * bScale,
                    bx + (float) p2[0] * bScale, by + (float) p2[1] * bScale));
        }

        // Panels: centre pentagon + five outer pentagons (rotated).
        fillPentagon(g, bx, by, bScale, BALL_CENTRE_PENTAGON, 0);
        for (int r = 0; r < 5; r++) fillPentagon(g, bx, by, bScale, BALL_OUTER_PENTAGON, r * 72);
    }

    /** Rotate (px,py) by {@code angRad} about the ball centre (50,50). */
    private static double[] rotate(double px, double py, double angRad) {
        double dx = px - 50, dy = py - 50;
        double c = Math.cos(angRad), s = Math.sin(angRad);
        return new double[]{50 + dx * c - dy * s, 50 + dx * s + dy * c};
    }

    /** Fill a teal pentagon given in internal ball coords, rotated by
     *  {@code angDeg} about (50,50) and mapped to device via (bx,by,bScale). */
    private static void fillPentagon(Graphics2D g, float bx, float by, float bScale,
                                     float[][] pts, double angDeg) {
        double a = Math.toRadians(angDeg);
        GeneralPath p = new GeneralPath();
        for (int i = 0; i < pts.length; i++) {
            double[] q = rotate(pts[i][0], pts[i][1], a);
            float dx = bx + (float) q[0] * bScale, dy = by + (float) q[1] * bScale;
            if (i == 0) p.moveTo(dx, dy); else p.lineTo(dx, dy);
        }
        p.closePath();
        g.setColor(TEAL);
        g.fill(p);
    }
}
