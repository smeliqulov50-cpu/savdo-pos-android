import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import '@capacitor/filesystem';
import '@capacitor/share';
import '@capacitor/push-notifications';
import '@capacitor/network';
import '@capacitor/browser';
window.Capacitor = Capacitor;
window.BleClient = BleClient;
