package savdo.pos.smm;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.Timer;
import java.util.TimerTask;
import java.util.UUID;

/* fix66: klassik Bluetooth (SPP) va Wi-Fi/LAN (TCP 9100) printerlar. Har chop etish: ulanadi -> yozadi -> yopadi. */
@CapacitorPlugin(name = "ClassicPrinter", permissions = {
    @Permission(alias = "bt", strings = { Manifest.permission.BLUETOOTH_CONNECT })
})
public class ClassicPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    /* fix102: har bir printer (manzil) uchun alohida qulf — bitta printer band bo'lsa boshqa printerga (masalan oshxona) chop etish kutib qolmaydi */
    private static final Map<String, Object> LOCKS = new HashMap<>();
    private static final Random RND = new Random();
    private static final long CONNECT_BUDGET_MS = 60000L;   // printer band bo'lsa shuncha vaqt navbat kutadi (10-30 qurilma bo'lishi mumkin)
    private static synchronized Object lockFor(String address) {
        Object l = LOCKS.get(address);
        if (l == null) { l = new Object(); LOCKS.put(address, l); }
        return l;
    }

    private boolean needBtPerm() {
        return Build.VERSION.SDK_INT >= 31 && getPermissionState("bt") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needBtPerm()) { requestPermissionForAlias("bt", call, "btPermCb"); return; }
        doList(call);
    }

    @PluginMethod
    public void printBt(PluginCall call) {
        if (needBtPerm()) { requestPermissionForAlias("bt", call, "btPermCb"); return; }
        doPrintBt(call);
    }

    @PermissionCallback
    private void btPermCb(PluginCall call) {
        if (getPermissionState("bt") != PermissionState.GRANTED) { call.reject("Bluetooth ruxsati berilmadi", "permission_denied"); return; }
        if ("listPaired".equals(call.getMethodName())) doList(call); else doPrintBt(call);
    }

    private void doList(PluginCall call) {
        try {
            BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
            if (ad == null) { call.reject("Bluetooth yo'q", "unavailable"); return; }
            if (!ad.isEnabled()) { call.reject("Bluetooth o'chiq", "disabled"); return; }
            JSArray arr = new JSArray();
            Set<BluetoothDevice> set = ad.getBondedDevices();
            if (set != null) for (BluetoothDevice d : set) {
                JSObject o = new JSObject();
                String n = d.getName();
                o.put("name", n == null ? d.getAddress() : n);
                o.put("address", d.getAddress());
                o.put("type", d.getType());
                arr.put(o);
            }
            JSObject r = new JSObject();
            r.put("devices", arr);
            call.resolve(r);
        } catch (SecurityException e) {
            call.reject("Bluetooth ruxsati yo'q", "permission_denied");
        } catch (Exception e) {
            call.reject("Xato: " + e.getMessage());
        }
    }

    private void doPrintBt(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || data == null) { call.reject("address/data yo'q", "invalid_data"); return; }
        new Thread(() -> {
            synchronized (lockFor(address)) {
                BluetoothSocket sock = null;
                Timer watchdog = null;
                try {
                    final byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                    BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
                    if (ad == null) { call.reject("Bluetooth yo'q", "unavailable"); return; }
                    try { ad.cancelDiscovery(); } catch (Exception ignored) {}
                    BluetoothDevice dev = ad.getRemoteDevice(address);
                    String lastErr = "";
                    long t0 = System.currentTimeMillis();
                    int i = 0;
                    /* fix102: printer boshqa qurilmada band bo'lsa ~60s gacha, tasodifiy kutish bilan qayta urinadi */
                    while (sock == null && System.currentTimeMillis() - t0 < CONNECT_BUDGET_MS) {
                        BluetoothSocket s = null;
                        try {
                            s = (i % 2 == 0) ? dev.createRfcommSocketToServiceRecord(SPP) : dev.createInsecureRfcommSocketToServiceRecord(SPP);
                            s.connect();
                            sock = s;
                        } catch (Exception e) {
                            lastErr = String.valueOf(e.getMessage());
                            try { if (s != null) s.close(); } catch (Exception ignored) {}
                            Thread.sleep(600 + RND.nextInt(1400));
                        }
                        i++;
                    }
                    if (sock == null) { call.reject("Printerga ulanib bo'lmadi: " + lastErr, "connect_failed"); return; }
                    /* fix102: qo'riqchi — printer qog'ozsiz/qopqoq ochiq bo'lib yozish qotib qolsa ham ulanish albatta yopiladi va printer bo'shaydi */
                    final BluetoothSocket guarded = sock;
                    watchdog = new Timer(true);
                    watchdog.schedule(new TimerTask() {
                        @Override public void run() { try { guarded.close(); } catch (Exception ignored) {} }
                    }, 20000L + bytes.length / 8L);
                    OutputStream os = sock.getOutputStream();
                    int off = 0;
                    while (off < bytes.length) {
                        int n = Math.min(512, bytes.length - off);
                        os.write(bytes, off, n);
                        os.flush();
                        off += n;
                        Thread.sleep(10);
                    }
                    Thread.sleep(Math.min(3000, 400 + bytes.length / 20));
                    call.resolve();
                } catch (SecurityException e) {
                    call.reject("Bluetooth ruxsati yo'q", "permission_denied");
                } catch (Exception e) {
                    call.reject("Chop etishda xato: " + e.getMessage(), "write_failed");
                } finally {
                    if (watchdog != null) watchdog.cancel();
                    try { if (sock != null) sock.close(); } catch (Exception ignored) {}
                    if (sock != null) { try { Thread.sleep(250); } catch (Exception ignored) {} }   // fix102: ulanish to'liq uzilib bo'lgach navbat boshqasiga o'tadi
                }
            }
        }).start();
    }

    @PluginMethod
    public void printTcp(final PluginCall call) {
        final String host = call.getString("host");
        final int port = call.getInt("port", 9100);
        final String data = call.getString("data");
        if (host == null || data == null) { call.reject("host/data yo'q", "invalid_data"); return; }
        new Thread(() -> {
            Socket s = new Socket();
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                s.connect(new InetSocketAddress(host, port), 5000);
                s.setSoTimeout(10000);
                OutputStream os = s.getOutputStream();
                os.write(bytes);
                os.flush();
                Thread.sleep(300);
                call.resolve();
            } catch (Exception e) {
                call.reject("Tarmoq printeriga ulanib bo'lmadi: " + e.getMessage(), "connect_failed");
            } finally {
                try { s.close(); } catch (Exception ignored) {}
            }
        }).start();
    }
}
