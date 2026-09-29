package com.stickitoutdrums.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openLoginLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openLoginLink(intent);
    }

    /** Email login links are https://member.stickitoutdrums.com/auth/callback. Open that page in the app. */
    private void openLoginLink(Intent intent) {
        if (intent == null || getBridge() == null || getBridge().getWebView() == null) return;
        Uri data = intent.getData();
        if (data == null || !"https".equals(data.getScheme())) return;
        if (!"member.stickitoutdrums.com".equals(data.getHost())) return;
        String path = data.getPath();
        if (path == null || !path.startsWith("/auth/callback")) return;
        getBridge().getWebView().loadUrl(data.toString());
    }
}
