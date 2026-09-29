package savdo.pos.smm;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long backPressedTime = 0;
    private Toast backToast;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UpdatePlugin.class);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);
        try {
            if (bridge != null && bridge.getWebView() != null) {
                android.webkit.WebView wv = bridge.getWebView();
                android.webkit.WebSettings ws = wv.getSettings();
                ws.setTextZoom(100);
                if (android.os.Build.VERSION.SDK_INT >= 29) wv.setForceDarkAllowed(false);
                if (android.os.Build.VERSION.SDK_INT >= 29 && android.os.Build.VERSION.SDK_INT < 33) ws.setForceDark(android.webkit.WebSettings.FORCE_DARK_OFF);
            }
        } catch (Exception ignored) {}
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                    return;
                }
                if (backPressedTime + 2000 > System.currentTimeMillis()) {
                    if (backToast != null) backToast.cancel();
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    return;
                } else {
                    backToast = Toast.makeText(MainActivity.this, "Chiqish uchun yana bir marta bosing", Toast.LENGTH_SHORT);
                    backToast.show();
                }
                backPressedTime = System.currentTimeMillis();
            }
        });
    }
}
