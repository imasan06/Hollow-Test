import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { activateLicense } from '@/services/licenseService';
import { Loader2, Key, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

interface LicenseScreenProps {
    onLicenseActivated: () => void;
}

export function LicenseScreen({ onLicenseActivated }: LicenseScreenProps) {
    const [licenseCode, setLicenseCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Format license code as user types (HOLLOW-XXXX-XXXX)
    const handleCodeChange = (value: string) => {
        // Remove any non-alphanumeric characters except hyphens
        let cleaned = value.toUpperCase().replace(/[^A-Z0-9-]/g, '');

        // Auto-format: add hyphens after HOLLOW and every 4 chars after
        if (cleaned.startsWith('HOLLOW') && cleaned.length > 6 && cleaned[6] !== '-') {
            cleaned = cleaned.slice(0, 6) + '-' + cleaned.slice(6);
        }
        if (cleaned.length > 11 && cleaned[11] !== '-') {
            cleaned = cleaned.slice(0, 11) + '-' + cleaned.slice(11);
        }

        // Limit length
        if (cleaned.length > 16) {
            cleaned = cleaned.slice(0, 16);
        }

        setLicenseCode(cleaned);
        setError(null);
    };

    const handleActivate = async () => {
        if (!licenseCode || licenseCode.length < 10) {
            setError('Please enter a valid license code');
            return;
        }

        setIsLoading(true);
        setError(null);

        const result = await activateLicense(licenseCode);

        setIsLoading(false);

        if (result.success) {
            setSuccess(true);
            // Brief delay to show success state
            setTimeout(() => {
                onLicenseActivated();
            }, 1000);
        } else {
            setError(result.error || 'Failed to activate license');
        }
    };

    const handleOpenSubscribe = () => {
        // Stripe payment link for $5/month subscription
        const subscribeUrl = 'https://buy.stripe.com/4gM00j4dQfuE31DdMH2oE01';

        if (Capacitor.isNativePlatform()) {
            // @ts-ignore - Browser plugin might be available
            window.open(subscribeUrl, '_system');
        } else {
            window.open(subscribeUrl, '_blank');
        }
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur-sm">
                <CardHeader className="text-center space-y-2">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                        <Key className="w-8 h-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-bold">Activate Hollow</CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Enter your license code to unlock the app
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* License Code Input */}
                    <div className="space-y-2">
                        <Input
                            value={licenseCode}
                            onChange={(e) => handleCodeChange(e.target.value)}
                            placeholder="HOLLOW-XXXX-XXXX"
                            className="text-center text-lg font-mono tracking-wider h-14 bg-background/50"
                            disabled={isLoading || success}
                            autoCapitalize="characters"
                            autoCorrect="off"
                            spellCheck="false"
                        />

                        {error && (
                            <div className="flex items-center gap-2 text-destructive text-sm">
                                <AlertCircle className="w-4 h-4" />
                                <span>{error}</span>
                            </div>
                        )}

                        {success && (
                            <div className="flex items-center gap-2 text-green-500 text-sm">
                                <CheckCircle className="w-4 h-4" />
                                <span>License activated successfully!</span>
                            </div>
                        )}
                    </div>

                    {/* Activate Button */}
                    <Button
                        onClick={handleActivate}
                        disabled={isLoading || success || !licenseCode}
                        className="w-full h-12 text-base font-medium"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                Activating...
                            </>
                        ) : success ? (
                            <>
                                <CheckCircle className="w-5 h-5 mr-2" />
                                Activated!
                            </>
                        ) : (
                            'Activate License'
                        )}
                    </Button>

                    {/* Divider */}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-border/50" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">
                                Don't have a license?
                            </span>
                        </div>
                    </div>

                    {/* Subscribe Button */}
                    <Button
                        variant="outline"
                        onClick={handleOpenSubscribe}
                        className="w-full h-12 text-base"
                    >
                        <ExternalLink className="w-5 h-5 mr-2" />
                        Subscribe for $5/month
                    </Button>

                    <p className="text-xs text-center text-muted-foreground">
                        After subscribing, you'll receive a license code to enter above.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
