package com.sparkdigitalmarketing.sparkerp;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_HOST = "spark-erp.local";
    private static final String START_URL = "https://" + APP_HOST + "/index.html?v=21";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new LocalAssetClient());
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

    private class LocalAssetClient extends WebViewClient {
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
}
