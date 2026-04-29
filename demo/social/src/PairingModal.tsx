
import React, { useState, useEffect, useRef } from 'react';
import { NativeWebRTCTransport } from '../../../src/adapters/NativeWebRTCTransport';
import { BLESignaling } from '../../../src/utils/BLESignaling';

interface PairingModalProps {
    userId: string;
    onClose: () => void;
    onConnected: (transport: NativeWebRTCTransport) => void;
}

export const PairingModal: React.FC<PairingModalProps> = ({ userId, onClose, onConnected }) => {
    const [step, setStep] = useState<'initial' | 'show-offer' | 'scan-offer' | 'show-answer' | 'scan-answer' | 'connecting' | 'success'>('initial');
    const [transport] = useState(() => new NativeWebRTCTransport(userId));
    const [qrValue, setQrValue] = useState<string>('');
    const [error, setError] = useState<string>('');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scannerRef = useRef<any>(null);

    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear();
            }
        };
    }, []);

    useEffect(() => {
        if (qrValue && canvasRef.current) {
            const generateQR = () => {
                // @ts-ignore - Loaded via CDN
                const lib = window.QRCode || window.qrcode;
                if (lib && lib.toCanvas) {
                    lib.toCanvas(canvasRef.current, qrValue, { width: 300 }, (error: any) => {
                        if (error) console.error('[QR] Error generating QR:', error);
                    });
                } else {
                    console.warn('[QR] QRCode library not yet available, retrying...');
                    setTimeout(generateQR, 500);
                }
            };
            generateQR();
        }
    }, [qrValue, step]);

    const handleCreateOffer = async () => {
        setStep('connecting');
        const offer = await transport.createOffer();
        setQrValue(JSON.stringify(offer));
        setStep('show-offer');

        transport.onConnected = () => {
            setStep('success');
            setTimeout(() => {
                onConnected(transport);
                onClose();
            }, 1500);
        };
    };

    const startScanner = (onScan: (data: string) => void) => {
        const initScanner = () => {
            // @ts-ignore - Loaded via CDN
            const Lib = window.Html5QrcodeScanner;
            if (Lib) {
                const scanner = new Lib("reader", { fps: 10, qrbox: 250 }, false);
                scanner.render((decodedText: string) => {
                    scanner.clear();
                    onScan(decodedText);
                }, (error: any) => {
                    // Silent errors while scanning
                });
                scannerRef.current = scanner;
            } else {
                console.warn('[QR] Scanner library not yet available, retrying...');
                setTimeout(initScanner, 500);
            }
        };
        initScanner();
    };

    const handleScanOffer = () => {
        setStep('scan-offer');
        setTimeout(() => {
            startScanner(async (data) => {
                try {
                    const offer = JSON.parse(data);
                    if (offer.type !== 'offer') throw new Error('Not an offer');
                    
                    const answer = await transport.handleOffer(offer.sdp);
                    setQrValue(JSON.stringify(answer));
                    setStep('show-answer');

                    transport.onConnected = () => {
                        setStep('success');
                        setTimeout(() => {
                            onConnected(transport);
                            onClose();
                        }, 1500);
                    };
                } catch (e) {
                    alert('Invalid QR Code: ' + e);
                    setStep('initial');
                }
            });
        }, 100);
    };

    const handleScanAnswer = () => {
        setStep('scan-answer');
        setTimeout(() => {
            startScanner(async (data) => {
                try {
                    const answer = JSON.parse(data);
                    if (answer.type !== 'answer') throw new Error('Not an answer');
                    await transport.handleAnswer(answer.sdp);
                } catch (e) {
                    alert('Invalid QR Code: ' + e);
                    setStep('initial');
                }
            });
        }, 100);
    };

    const handleBluetoothScan = async () => {
        try {
            setError('');
            setStep('connecting');
            await BLESignaling.scanAndPair(async (offerStr) => {
                const offer = JSON.parse(offerStr);
                const answer = await transport.handleOffer(offer.sdp);
                
                transport.onConnected = () => {
                    setStep('success');
                    setTimeout(() => {
                        onConnected(transport);
                        onClose();
                    }, 1500);
                };

                return JSON.stringify(answer);
            });
        } catch (e: any) {
            setError(e.message);
            setStep('initial');
        }
    };

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000 }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content border-0 rounded-4 overflow-hidden">
                    <div className="modal-header bg-primary text-white border-0">
                        <h5 className="modal-title fw-bold">
                            <i className="bi bi-qr-code-scan me-2"></i>
                            Direct Pairing
                        </h5>
                        <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
                    </div>
                    <div className="modal-body p-4 text-center">
                        {error && <div className="alert alert-danger small py-2">{error}</div>}
                        
                        {step === 'initial' && (
                            <div className="py-3">
                                <p className="text-secondary mb-4">Pair directly with another device without using a server or the internet.</p>
                                <button className="btn btn-primary w-100 py-3 mb-3 fw-bold rounded-pill" onClick={handleCreateOffer}>
                                    <i className="bi bi-broadcast me-2"></i> 1. I am the INITIATOR (QR)
                                </button>
                                <button className="btn btn-outline-primary w-100 py-3 mb-3 fw-bold rounded-pill" onClick={handleScanOffer}>
                                    <i className="bi bi-camera me-2"></i> 2. I am the RECEIVER (QR)
                                </button>
                                
                                <div className="divider text-muted small my-3"><span>OR</span></div>
                                
                                <button className="btn btn-dark w-100 py-3 fw-bold rounded-pill" onClick={handleBluetoothScan}>
                                    <i className="bi bi-bluetooth me-2"></i> Scan via Bluetooth
                                </button>
                                <p className="text-muted extra-small mt-2" style={{fontSize: '0.7rem'}}>
                                    * Bluetooth requires a Sovereign Peripheral (like a Headless Peer) to be advertising.
                                </p>
                            </div>
                        )}

                        {step === 'show-offer' && (
                            <div>
                                <h6 className="fw-bold mb-3 text-primary">SCAN ME</h6>
                                <p className="small text-muted mb-3">Ask the other device to scan this QR code to start the handshake.</p>
                                <div className="bg-white p-3 rounded shadow-sm d-inline-block mb-3">
                                    <canvas ref={canvasRef}></canvas>
                                </div>
                                <button className="btn btn-success w-100 py-2 rounded-pill fw-bold" onClick={handleScanAnswer}>
                                    Next: Scan their Answer
                                </button>
                            </div>
                        )}

                        {step === 'scan-offer' && (
                            <div>
                                <h6 className="fw-bold mb-3 text-primary">SCAN INITIATOR</h6>
                                <p className="small text-muted mb-3">Position the Initiator's QR code in the camera frame.</p>
                                <div id="reader" style={{ width: '100%', borderRadius: '8px', overflow: 'hidden' }}></div>
                            </div>
                        )}

                        {step === 'show-answer' && (
                            <div>
                                <h6 className="fw-bold mb-3 text-success">SCAN MY ANSWER</h6>
                                <p className="small text-muted mb-3">Initiator must scan this QR code to complete the pairing.</p>
                                <div className="bg-white p-3 rounded shadow-sm d-inline-block mb-3">
                                    <canvas ref={canvasRef}></canvas>
                                </div>
                                <div className="alert alert-info py-2 small">Waiting for connection...</div>
                            </div>
                        )}

                        {step === 'scan-answer' && (
                            <div>
                                <h6 className="fw-bold mb-3 text-primary">SCAN RECEIVER'S ANSWER</h6>
                                <p className="small text-muted mb-3">Final step: Scan the QR code shown on the Receiver's device.</p>
                                <div id="reader" style={{ width: '100%', borderRadius: '8px', overflow: 'hidden' }}></div>
                            </div>
                        )}

                        {(step === 'connecting' || step === 'success') && (
                            <div className="py-5">
                                {step === 'connecting' ? (
                                    <>
                                        <div className="spinner-border text-primary mb-3" role="status"></div>
                                        <p className="fw-bold">Initializing WebRTC...</p>
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '4rem' }}></i>
                                        <p className="fw-bold mt-3 h5">Connection Established!</p>
                                        <p className="text-muted small">Devices are now syncing directly.</p>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
