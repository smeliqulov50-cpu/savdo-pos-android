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
import java.util.Set;
import java.util.UUID;

/* fix66: klassik Bluetooth (SPP) va Wi-Fi/LAN (TCP 9100) printerlar. Har chop etish: ulanadi -> yozadi -> yopadi. */
@CapacitorPlugin(name = "ClassicPrinter", permissions = {
    @Permission(alias = "bt", strings = { Manifest.permission.BLUETOOTH_CONNECT })
})
public class ClassicPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final Object LOCK = new Object();

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
            synchronized (LOCK) {
                BluetoothSocket sock = null;
                try {
                    byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                    BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
                    if (ad == null) { call.reject("Bluetooth yo'q", "unavailable"); return; }
                    try { ad.cancelDiscovery(); } catch (Exception ignored) {}
                    BluetoothDevice dev = ad.getRemoteDevice(address);
                    String lastErr = "";
                    for (int i = 0; i < 6 && sock == null; i++) {
                        BluetoothSocket s = null;
                        try {
                            s = (i % 2 == 0) ? dev.createRfcommSocketToServiceRecord(SPP) : dev.createInsecureRfcommSocketToServiceRecord(SPP);
                            s.connect();
                            sock = s;
                        } catch (Exception e) {
                            lastErr = String.valueOf(e.getMessage());
                            try { if (s != null) s.close(); } catch (Exception ignored) {}
                            Thread.sleep(1500);
                        }
                    }
                    if (sock == null) { call.reject("Printerga ulanib bo'lmadi: " + lastErr, "connect_failed"); return; }
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
                    try { if (sock != null) sock.close(); } catch (Exception ignored) {}
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
