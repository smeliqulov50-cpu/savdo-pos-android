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
        registerPlugin(ClassicPrinterPlugin.class);   // fix66
        registerPlugin(ContactPickerPlugin.class);   // fix113-contact
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        try { if (getSupportActionBar() != null) getSupportActionBar().hide(); } catch (Exception ignored) {}
        try {
            if (bridge != null && bridge.getWebView() != null) {
                android.webkit.WebView wv = bridge.getWebView();
                android.webkit.WebSettings ws = wv.getSettings();
                int __maxZoom = getResources().getConfiguration().smallestScreenWidthDp >= 600 ? 130 : 115;
                int __zoom = Math.round(getResources().getConfiguration().fontScale * 100f);
                if (__zoom < 100) __zoom = 100;
                if (__zoom > __maxZoom) __zoom = __maxZoom;
                ws.setTextZoom(__zoom);
                if (android.os.Build.VERSION.SDK_INT >= 29) wv.setForceDarkAllowed(false);
                if (android.os.Build.VERSION.SDK_INT >= 29 && android.os.Build.VERSION.SDK_INT < 33) ws.setForceDark(android.webkit.WebSettings.FORCE_DARK_OFF);
            }
        } catch (Exception ignored) {}
        // fix202-back: orqaga tugmasini endi faqat ilova ichidagi kod boshqaradi (@capacitor/app "backButton").
        // Eski kod bu yerda edi: 2-bosishda o'zini o'chirib, bosishni plaginga berardi — plagin esa hech narsa qilmasdi, ilova chiqmasdi.
    }
}
