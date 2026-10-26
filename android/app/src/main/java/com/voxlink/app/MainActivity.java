package com.voxlink.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_SCREEN_CAPTURE = 9921;
    private MediaProjectionManager projectionManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        // Configure WebView for direct native audio/video access & screen share bridge
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setDatabaseEnabled(true);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.addJavascriptInterface(new NativeScreenShareBridge(), "AndroidNative");

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    // Grant microphone & camera resources to VoxLink
                    request.grant(request.getResources());
                }

                @Override
                public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, android.webkit.JsPromptResult result) {
                    final android.widget.EditText input = new android.widget.EditText(MainActivity.this);
                    input.setText(defaultValue);
                    new android.app.AlertDialog.Builder(MainActivity.this)
                            .setTitle("VoxLink")
                            .setMessage(message)
                            .setView(input)
                            .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm(input.getText().toString()))
                            .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                            .setOnCancelListener(dialog -> result.cancel())
                            .show();
                    return true;
                }
            });
        }
    }

    public class NativeScreenShareBridge {
        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public boolean isScreenCapturing() {
            return ScreenCaptureService.isRunning();
        }

        @JavascriptInterface
        public void startScreenCapture() {
            runOnUiThread(() -> {
                if (projectionManager != null) {
                    Intent captureIntent = projectionManager.createScreenCaptureIntent();
                    startActivityForResult(captureIntent, REQUEST_SCREEN_CAPTURE);
                }
            });
        }

        @JavascriptInterface
        public void stopScreenCapture() {
            runOnUiThread(() -> {
                Intent serviceIntent = new Intent(MainActivity.this, ScreenCaptureService.class);
                serviceIntent.setAction(ScreenCaptureService.ACTION_STOP);
                startService(serviceIntent);

                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.evaluateJavascript("if (window.__onNativeScreenCaptureStopped) window.__onNativeScreenCaptureStopped();", null);
                }
            });
        }

        @JavascriptInterface
        public String getLatestFrame() {
            byte[] jpeg = ScreenCaptureService.getLatestJpeg();
            if (jpeg != null && jpeg.length > 0) {
                return android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP);
            }
            return null;
        }

        @JavascriptInterface
        public int getCaptureWidth() {
            return ScreenCaptureService.getCaptureWidth();
        }

        @JavascriptInterface
        public int getCaptureHeight() {
            return ScreenCaptureService.getCaptureHeight();
        }

        @JavascriptInterface
        public String getDebugStatus() {
            return ScreenCaptureService.getDebugStatus();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_SCREEN_CAPTURE) {
            WebView webView = getBridge().getWebView();
            if (resultCode == Activity.RESULT_OK && data != null) {
                Intent serviceIntent = new Intent(this, ScreenCaptureService.class);
                serviceIntent.setAction(ScreenCaptureService.ACTION_START);
                serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode);
                serviceIntent.putExtra(ScreenCaptureService.EXTRA_DATA, data);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent);
                } else {
                    startService(serviceIntent);
                }

                if (webView != null) {
                    webView.evaluateJavascript("if (window.__onNativeScreenCaptureStarted) window.__onNativeScreenCaptureStarted(" + ScreenCaptureService.HTTP_PORT + ");", null);
                }
            } else {
                if (webView != null) {
                    webView.evaluateJavascript("if (window.__onNativeScreenCaptureFailed) window.__onNativeScreenCaptureFailed('Permission denied by user');", null);
                }
            }
        }
    }
}
