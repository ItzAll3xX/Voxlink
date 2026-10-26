package com.voxlink.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.concurrent.CopyOnWriteArrayList;

public class ScreenCaptureService extends Service {
    private static final String TAG = "VoxLinkScreenCapture";
    private static final String CHANNEL_ID = "voxlink_screenshare_channel";
    private static final int NOTIFICATION_ID = 2026;
    public static final int HTTP_PORT = 8765;

    public static final String ACTION_START = "com.voxlink.app.ACTION_START";
    public static final String ACTION_STOP = "com.voxlink.app.ACTION_STOP";
    public static final String EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE";
    public static final String EXTRA_DATA = "EXTRA_DATA";

    private static boolean running = false;

    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;

    private HandlerThread backgroundThread;
    private Handler backgroundHandler;

    private ServerSocket serverSocket;
    private Thread serverThread;
    private final CopyOnWriteArrayList<OutputStream> clientStreams = new CopyOnWriteArrayList<>();

    private int width = 1280;
    private int height = 720;
    private int densityDpi = 240;

    private static volatile byte[] latestJpeg = null;
    private static volatile int captureWidth = 720;
    private static volatile int captureHeight = 1280;
    private static volatile String debugStatus = "Starting";
    private static volatile long debugFrameCount = 0;
    private final Object frameLock = new Object();

    public static byte[] getLatestJpeg() {
        return latestJpeg;
    }

    public static int getCaptureWidth() {
        return captureWidth;
    }

    public static int getCaptureHeight() {
        return captureHeight;
    }

    public static String getDebugStatus() {
        return debugStatus + " | Frames: " + debugFrameCount + " | Latest: " + (latestJpeg != null ? latestJpeg.length + "B" : "null");
    }

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        createNotificationChannel();

        backgroundThread = new HandlerThread("ScreenCaptureThread");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());

        startHttpServer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopCapture();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(action)) {
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            Intent data = intent.getParcelableExtra(EXTRA_DATA);

            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            if (resultCode != 0 && data != null) {
                startCapture(resultCode, data);
            }
        }

        return START_NOT_STICKY;
    }

    private void startCapture(int resultCode, Intent data) {
        try {
            WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            DisplayMetrics metrics = new DisplayMetrics();
            if (wm != null && wm.getDefaultDisplay() != null) {
                wm.getDefaultDisplay().getRealMetrics(metrics);
                densityDpi = metrics.densityDpi;
                int screenW = metrics.widthPixels;
                int screenH = metrics.heightPixels;
                if (screenW > 0 && screenH > 0) {
                    if (screenW < screenH) {
                        width = 720;
                        height = (int) Math.round((720.0 * screenH) / screenW);
                        if (height % 2 != 0) height++;
                        if (height > 1600) height = 1600;
                    } else {
                        height = 720;
                        width = (int) Math.round((720.0 * screenW) / screenH);
                        if (width % 2 != 0) width++;
                        if (width > 1600) width = 1600;
                    }
                }
            }

            captureWidth = width;
            captureHeight = height;

            mediaProjection = projectionManager.getMediaProjection(resultCode, data);
            if (mediaProjection == null) {
                Log.e(TAG, "MediaProjection was null");
                stopSelf();
                return;
            }

            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    super.onStop();
                    stopCapture();
                    stopSelf();
                }
            }, backgroundHandler);

            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "VoxLinkScreen",
                    width, height, densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(),
                    null, backgroundHandler
            );

            imageReader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
                private long lastFrameTime = 0;
                private static final long FRAME_INTERVAL_MS = 33; // ~30 fps cap

                @Override
                public void onImageAvailable(ImageReader reader) {
                    Image image = null;
                    try {
                        image = reader.acquireLatestImage();
                        if (image == null) return;

                        long now = System.currentTimeMillis();
                        if (now - lastFrameTime < FRAME_INTERVAL_MS) {
                            return;
                        }
                        lastFrameTime = now;

                        Image.Plane[] planes = image.getPlanes();
                        ByteBuffer buffer = planes[0].getBuffer();
                        int pixelStride = planes[0].getPixelStride();
                        int rowStride = planes[0].getRowStride();
                        int rowPadding = rowStride - pixelStride * width;

                        int bitmapWidth = width + rowPadding / pixelStride;
                        int requiredBytes = bitmapWidth * height * 4;

                        Bitmap bitmap;
                        if (buffer.remaining() < requiredBytes) {
                            ByteBuffer paddedBuffer = ByteBuffer.allocate(requiredBytes);
                            paddedBuffer.put(buffer);
                            paddedBuffer.rewind();
                            bitmap = Bitmap.createBitmap(bitmapWidth, height, Bitmap.Config.ARGB_8888);
                            bitmap.copyPixelsFromBuffer(paddedBuffer);
                        } else {
                            bitmap = Bitmap.createBitmap(bitmapWidth, height, Bitmap.Config.ARGB_8888);
                            bitmap.copyPixelsFromBuffer(buffer);
                        }

                        Bitmap croppedBitmap = bitmap;
                        if (rowPadding != 0) {
                            croppedBitmap = Bitmap.createBitmap(bitmap, 0, 0, width, height);
                        }

                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        croppedBitmap.compress(Bitmap.CompressFormat.JPEG, 70, baos);
                        byte[] jpegBytes = baos.toByteArray();

                        synchronized (frameLock) {
                            latestJpeg = jpegBytes;
                            debugFrameCount++;
                            debugStatus = "OK " + width + "x" + height;
                            frameLock.notifyAll();
                        }

                        if (croppedBitmap != bitmap) {
                            croppedBitmap.recycle();
                        }
                        bitmap.recycle();

                    } catch (Exception e) {
                        debugStatus = "Err: " + e.getClass().getSimpleName() + ": " + e.getMessage();
                        Log.e(TAG, "Error processing screen frame", e);
                    } finally {
                        if (image != null) {
                            try { image.close(); } catch (Exception ignored) {}
                        }
                    }
                }
            }, backgroundHandler);

            running = true;
            Log.i(TAG, "Native screen capture successfully started");

        } catch (Exception e) {
            Log.e(TAG, "Failed to start media projection", e);
            stopSelf();
        }
    }

    private void startHttpServer() {
        serverThread = new Thread(() -> {
            try {
                serverSocket = new ServerSocket(HTTP_PORT);
                Log.i(TAG, "MJPEG stream server listening on http://127.0.0.1:" + HTTP_PORT);

                while (!serverSocket.isClosed()) {
                    Socket socket = serverSocket.accept();
                    new Thread(() -> handleHttpClient(socket)).start();
                }
            } catch (Exception e) {
                Log.w(TAG, "Server socket closed: " + e.getMessage());
            }
        });
        serverThread.setDaemon(true);
        serverThread.start();
    }

    private void handleHttpClient(Socket socket) {
        try {
            java.io.InputStream in = socket.getInputStream();
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(in));
            String reqLine = reader.readLine();
            if (reqLine == null) {
                socket.close();
                return;
            }
            while (true) {
                String line = reader.readLine();
                if (line == null || line.trim().isEmpty()) break;
            }

            OutputStream out = socket.getOutputStream();

            if (reqLine.startsWith("GET /frame") || reqLine.startsWith("GET /snapshot")) {
                byte[] frame;
                synchronized (frameLock) {
                    frame = latestJpeg;
                }
                if (frame != null && frame.length > 0) {
                    String resp = "HTTP/1.1 200 OK\r\n" +
                            "Access-Control-Allow-Origin: *\r\n" +
                            "Content-Type: image/jpeg\r\n" +
                            "Content-Length: " + frame.length + "\r\n" +
                            "Connection: close\r\n\r\n";
                    out.write(resp.getBytes());
                    out.write(frame);
                    out.flush();
                } else {
                    String resp = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n";
                    out.write(resp.getBytes());
                    out.flush();
                }
                socket.close();
                return;
            }

            clientStreams.add(out);

            String header = "HTTP/1.1 200 OK\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Cache-Control: no-cache, no-store, must-revalidate\r\n" +
                    "Pragma: no-cache\r\n" +
                    "Connection: close\r\n" +
                    "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
            out.write(header.getBytes());
            out.flush();

            byte[] lastSentFrame = null;
            while (running && !socket.isClosed()) {
                byte[] frame;
                synchronized (frameLock) {
                    while (running && latestJpeg == lastSentFrame) {
                        frameLock.wait(100);
                    }
                    frame = latestJpeg;
                }

                if (frame != null && frame.length > 0) {
                    lastSentFrame = frame;
                    String partHeader = "--frame\r\n" +
                            "Content-Type: image/jpeg\r\n" +
                            "Content-Length: " + frame.length + "\r\n\r\n";
                    out.write(partHeader.getBytes());
                    out.write(frame);
                    out.write("\r\n".getBytes());
                    out.flush();
                }
            }
        } catch (Exception ignored) {
        } finally {
            try { socket.close(); } catch (Exception ignored) {}
        }
    }

    private void stopCapture() {
        running = false;
        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        if (imageReader != null) {
            try { imageReader.close(); } catch (Exception ignored) {}
            imageReader = null;
        }
        if (mediaProjection != null) {
            try { mediaProjection.stop(); } catch (Exception ignored) {}
            mediaProjection = null;
        }
        synchronized (frameLock) {
            frameLock.notifyAll();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "VoxLink Screen Sharing",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Ongoing notification while sharing your mobile screen in VoxLink");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ?
                new Notification.Builder(this, CHANNEL_ID) :
                new Notification.Builder(this);

        return builder
                .setContentTitle("VoxLink Screen Share")
                .setContentText("Broadcasting screen to voice channel live")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        stopCapture();
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (Exception ignored) {}
        }
        if (backgroundThread != null) {
            backgroundThread.quitSafely();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
