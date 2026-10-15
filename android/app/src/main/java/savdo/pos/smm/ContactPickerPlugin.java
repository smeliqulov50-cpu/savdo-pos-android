package savdo.pos.smm;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/* fix113-contact: telefon kitobidan bitta raqam tanlash. Android'ning o'z tanlash oynasi ishlatiladi —
   READ_CONTACTS ruxsati kerak emas: tizim faqat foydalanuvchi tanlagan bitta raqamga vaqtinchalik ruxsat beradi. */
@CapacitorPlugin(name = "ContactPick")
public class ContactPickerPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
            startActivityForResult(call, intent, "pickResult");
        } catch (ActivityNotFoundException e) {
            call.reject("Kontaktlar ilovasi topilmadi", "no_app");
            try { getBridge().releaseCall(call); } catch (Exception ignored) {}
        } catch (Exception e) {
            call.reject("Xato: " + e.getMessage(), "error");
            try { getBridge().releaseCall(call); } catch (Exception ignored) {}
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            Intent data = (result != null) ? result.getData() : null;
            if (result == null || result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
                JSObject r = new JSObject();
                r.put("cancelled", true);
                call.resolve(r);
                return;
            }
            Uri uri = data.getData();
            String number = null, name = null;
            Cursor c = null;
            try {
                c = getContext().getContentResolver().query(uri, new String[] {
                    ContactsContract.CommonDataKinds.Phone.NUMBER,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
                }, null, null, null);
                if (c != null && c.moveToFirst()) {
                    number = c.getString(0);
                    name = c.getString(1);
                }
            } finally {
                if (c != null) c.close();
            }
            if (number == null || number.trim().isEmpty()) {
                call.reject("Raqam o'qilmadi", "no_number");
                return;
            }
            JSObject r = new JSObject();
            r.put("cancelled", false);
            r.put("phone", number);
            r.put("name", name == null ? "" : name);
            call.resolve(r);
        } catch (SecurityException e) {
            call.reject("Kontaktga ruxsat berilmadi", "permission");
        } catch (Exception e) {
            call.reject("Xato: " + e.getMessage(), "error");
        } finally {
            try { getBridge().releaseCall(call); } catch (Exception ignored) {}
        }
    }
}
