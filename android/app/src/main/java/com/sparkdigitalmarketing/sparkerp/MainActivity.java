package com.sparkdigitalmarketing.sparkerp;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_HOST = "spark-erp.local";
    private static final String START_URL = "https://" + APP_HOST + "/index.html?v=25";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private WebView webView;
    private long updateDownloadId = -1L;
    private DownloadManager downloadManager;
    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (id == updateDownloadId) installDownloadedApk(id);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new AndroidBridge(), "SparkAndroid");
        webView.setWebViewClient(new LocalAssetClient());
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> downloadApk(url));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }
        webView.loadUrl(START_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(downloadReceiver);
        super.onDestroy();
    }

    private class LocalAssetClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleExternalUrl(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleExternalUrl(Uri.parse(url));
        }

        private boolean handleExternalUrl(Uri uri) {
            String host = uri.getHost();
            if (APP_HOST.equals(host)) return false;
            if ("github.com".equals(host) || "objects.githubusercontent.com".equals(host)) {
                if (uri.getPath() != null && uri.getPath().endsWith(".apk")) {
                    downloadApk(uri.toString());
                } else {
                    openExternal(uri.toString());
                }
                return true;
            }
            return false;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (!APP_HOST.equals(request.getUrl().getHost())) return null;
            String path = request.getUrl().getPath();
            if (path == null || "/".equals(path)) path = "/index.html";
            String assetPath = "www" + path;
            try {
                InputStream stream = getAssets().open(assetPath);
                return new WebResourceResponse(mimeType(path), "UTF-8", 200, "OK", headers(), stream);
            } catch (IOException ignored) {
                return null;
            }
        }

        private Map<String, String> headers() {
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            return headers;
        }

        private String mimeType(String path) {
            if (path.endsWith(".js")) return "text/javascript";
            if (path.endsWith(".css")) return "text/css";
            if (path.endsWith(".html")) return "text/html";
            if (path.endsWith(".json")) return "application/json";
            if (path.endsWith(".avif")) return "image/avif";
            if (path.endsWith(".svg")) return "image/svg+xml";
            String ext = MimeTypeMap.getFileExtensionFromUrl(path);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            return mime == null ? "application/octet-stream" : mime;
        }
    }

    private void openExternal(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            webView.loadUrl(url);
        }
    }

    private void downloadApk(String url) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Spark ERP update");
            request.setDescription("Downloading latest Spark ERP APK");
            request.setMimeType(APK_MIME);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "Spark-ERP-update.apk");
            updateDownloadId = downloadManager.enqueue(request);
            Toast.makeText(this, "APK download start ho gaya", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "Download open nahi ho raha, browser me try karein", Toast.LENGTH_LONG).show();
            openExternal(url);
        }
    }

    private void installDownloadedApk(long id) {
        try {
            Uri apkUri = downloadManager.getUriForDownloadedFile(id);
            if (apkUri == null) return;
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, APK_MIME);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(install);
        } catch (Exception error) {
            Toast.makeText(this, "Install permission allow karke APK open karein", Toast.LENGTH_LONG).show();
            startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS));
        }
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void downloadApk(String url) {
            runOnUiThread(() -> MainActivity.this.downloadApk(url));
        }
    }
}
