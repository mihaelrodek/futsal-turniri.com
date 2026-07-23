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
    private static final Color WHITE = Color.WHITE;

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
     * then the light tile with the teal goal-frame + ball (same mark as the
     * in-app Logo / app icon). EC-H means the obscured centre modules are
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

        // Goal frame (upside-down U) in teal.
        float s = markSize;
        g.setColor(TEAL);
        g.setStroke(new BasicStroke(Math.max(2f, s * 0.05f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        float gx = x + s * 0.26f;
        float gy = y + s * 0.30f;
        float gw = s * 0.48f;
        float gh = s * 0.34f;
        g.drawLine(Math.round(gx), Math.round(gy + gh), Math.round(gx), Math.round(gy));
        g.drawLine(Math.round(gx), Math.round(gy), Math.round(gx + gw), Math.round(gy));
        g.drawLine(Math.round(gx + gw), Math.round(gy), Math.round(gx + gw), Math.round(gy + gh));

        // Ball - white circle with a teal outline + small teal pentagon,
        // bottom-centre. The outline is what makes the white ball read on the
        // light tile.
        float ballR = s * 0.18f;
        float bcx = x + s / 2f;
        float bcy = y + s * 0.66f;
        Ellipse2D.Float ball = new Ellipse2D.Float(bcx - ballR, bcy - ballR, ballR * 2, ballR * 2);
        g.setColor(WHITE);
        g.fill(ball);
        g.setColor(TEAL);
        g.setStroke(new BasicStroke(Math.max(1.5f, s * 0.035f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.draw(ball);
        int[] px = new int[5];
        int[] py = new int[5];
        for (int i = 0; i < 5; i++) {
            double ang = Math.toRadians(-90 + i * 72);
            px[i] = Math.round(bcx + (float) Math.cos(ang) * (ballR * 0.45f));
            py[i] = Math.round(bcy + (float) Math.sin(ang) * (ballR * 0.45f));
        }
        g.fillPolygon(px, py, 5);
    }
}
