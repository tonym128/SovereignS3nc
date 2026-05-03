
import { WebRTCSignalingData } from '../types';
import { Logger } from './Logger';

export const SOVEREIGN_SERVICE_UUID = '00005056-0000-1000-8000-00805f9b34fb'; // 'SOV'
export const SIGNAL_CHARACTERISTIC_UUID = '00005057-0000-1000-8000-00805f9b34fb'; // 'SIG'

export class BLESignaling {
    /**
     * Browser (Central) scans for a Sovereign Peripheral and performs a handshake.
     */
    public static async scanAndPair(onOfferReceived: (offer: string) => Promise<string>): Promise<void> {
        if (!(navigator as any).bluetooth) {
            throw new Error('Web Bluetooth is not supported in this browser.');
        }

        Logger.info('BLE', 'Scanning for Sovereign devices...');
        
        const device = await (navigator as any).bluetooth.requestDevice({
            filters: [{ services: [SOVEREIGN_SERVICE_UUID] }]
        });

        Logger.info('BLE', `Found device: ${device.name}. Connecting...`);
        const server = await device.gatt?.connect();
        const service = await server?.getPrimaryService(SOVEREIGN_SERVICE_UUID);
        const characteristic = await service?.getCharacteristic(SIGNAL_CHARACTERISTIC_UUID);

        if (!characteristic) throw new Error('Signaling characteristic not found');

        // 1. Read Offer from Peripheral
        const offerValue = await characteristic.readValue();
        const offerStr = new TextDecoder().decode(offerValue);
        Logger.info('BLE', 'Received WebRTC Offer via Bluetooth');

        // 2. Process Offer and generate Answer
        const answerStr = await onOfferReceived(offerStr);

        // 3. Write Answer back to Peripheral
        const answerData = new TextEncoder().encode(answerStr);
        
        // BLE MTU is small (usually 20-512 bytes). 
        // We might need to write in chunks if the SDP is large.
        if (answerData.length > 512) {
            Logger.warn('BLE', 'Answer SDP is large, attempting chunked write...');
            // Simple chunked write implementation would go here
            await characteristic.writeValue(answerData);
        } else {
            await characteristic.writeValue(answerData);
        }

        Logger.info('BLE', 'Handshake complete via Bluetooth');
    }
}
