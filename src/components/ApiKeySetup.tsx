import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Key, Eye, EyeOff, CheckCircle, AlertCircle, ExternalLink, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApiKeySetupProps {
  onComplete: () => void;
}

type SetupMode = 'mainnet' | 'testnet';

const ApiKeySetup = ({ onComplete }: ApiKeySetupProps) => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [hasMainnetKeys, setHasMainnetKeys] = useState(false);
  const [hasTestnetKeys, setHasTestnetKeys] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>('mainnet');
  const [showSetupForm, setShowSetupForm] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Check if user already has API keys
  useEffect(() => {
    const checkExistingKeys = async () => {
      if (!user) return;
      
      try {
        // Check mainnet keys
        const { data: mainnetData } = await supabase
          .from('user_api_keys')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_testnet', false)
          .single();
        
        if (mainnetData) {
          setHasMainnetKeys(true);
        }

        // Check testnet keys
        const { data: testnetData } = await supabase
          .from('user_api_keys')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_testnet', true)
          .single();
        
        if (testnetData) {
          setHasTestnetKeys(true);
        }
      } catch (e) {
        console.log('Checking keys...');
      } finally {
        setIsChecking(false);
      }
    };

    checkExistingKeys();
  }, [user]);

  const validateAndSaveKeys = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast({
        title: '입력 오류',
        description: 'API Key와 Secret Key를 모두 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({
        title: '인증 오류',
        description: '로그인이 필요합니다.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    const isTestnet = setupMode === 'testnet';

    try {
      // First, delete existing keys for this mode (if any)
      await supabase
        .from('user_api_keys')
        .delete()
        .eq('user_id', user.id)
        .eq('is_testnet', isTestnet);

      // Save the new keys
      const { error: insertError } = await supabase
        .from('user_api_keys')
        .insert({
          user_id: user.id,
          api_key: apiKey.trim(),
          api_secret: apiSecret.trim(),
          is_testnet: isTestnet,
        });

      if (insertError) {
        throw insertError;
      }

      // Test the API connection
      const { data, error } = await supabase.functions.invoke('binance-api', {
        body: { action: 'getBalance', testnet: isTestnet }
      });

      if (error || data?.error) {
        // Delete the invalid keys
        await supabase
          .from('user_api_keys')
          .delete()
          .eq('user_id', user.id)
          .eq('is_testnet', isTestnet);
        
        throw new Error(data?.error || 'API 연결 테스트 실패');
      }

      toast({
        title: isTestnet ? '✅ 테스트넷 API 연동 성공' : '✅ API 연동 성공',
        description: isTestnet ? '바이낸스 테스트넷이 연결되었습니다.' : '바이낸스 계정이 연결되었습니다.',
      });

      if (isTestnet) {
        setHasTestnetKeys(true);
      } else {
        setHasMainnetKeys(true);
      }
      setShowSetupForm(false);
      setApiKey('');
      setApiSecret('');
    } catch (error: any) {
      console.error('API key save error:', error);
      toast({
        title: 'API 연동 실패',
        description: error.message || '유효하지 않은 API Key입니다. 권한을 확인해주세요.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">API 키 확인중...</div>
      </div>
    );
  }

  // Show setup form
  if (showSetupForm) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg bg-card border-border">
          <CardHeader className="text-center">
            <div className={cn(
              "mx-auto mb-4 p-3 rounded-full w-fit",
              setupMode === 'testnet' ? "bg-orange-500/10" : "bg-primary/10"
            )}>
              {setupMode === 'testnet' ? (
                <FlaskConical className="h-8 w-8 text-orange-500" />
              ) : (
                <Key className="h-8 w-8 text-primary" />
              )}
            </div>
            <CardTitle className="text-foreground">
              {setupMode === 'testnet' ? '테스트넷 API 연동' : '바이낸스 API 연동'}
            </CardTitle>
            <CardDescription>
              {setupMode === 'testnet' 
                ? '모의 거래를 위한 테스트넷 API 키를 등록해주세요.'
                : '실거래를 위해 바이낸스 API 키를 등록해주세요.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Warning */}
            <div className={cn(
              "p-3 border rounded-lg",
              setupMode === 'testnet' 
                ? "bg-orange-500/10 border-orange-500/30" 
                : "bg-yellow-500/10 border-yellow-500/30"
            )}>
              <div className="flex items-start gap-2">
                <AlertCircle className={cn(
                  "h-5 w-5 shrink-0 mt-0.5",
                  setupMode === 'testnet' ? "text-orange-500" : "text-yellow-500"
                )} />
                <div className={cn(
                  "text-xs",
                  setupMode === 'testnet' ? "text-orange-200" : "text-yellow-200"
                )}>
                  {setupMode === 'testnet' ? (
                    <>
                      <p className="font-semibold mb-1">테스트넷 API 키 발급:</p>
                      <p className="text-orange-300/80">
                        testnet.binancefuture.com 에서 별도로 API 키를 발급받아야 합니다.
                        테스트넷은 가상 자금으로 연습할 수 있습니다.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold mb-1">API 키 생성 시 필수 설정:</p>
                      <ul className="list-disc list-inside space-y-0.5 text-yellow-300/80">
                        <li>선물 거래(Futures) 권한 활성화</li>
                        <li>IP 제한 없음 또는 Edge Function IP 허용</li>
                        <li>출금 권한은 <span className="text-red-400 font-bold">절대 비활성화</span></li>
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* API Key Input */}
            <div className="space-y-2">
              <Label htmlFor="apiKey" className="text-foreground">API Key</Label>
              <Input
                id="apiKey"
                type="text"
                placeholder="API Key를 입력하세요"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-background border-border text-foreground font-mono text-sm"
              />
            </div>

            {/* Secret Key Input */}
            <div className="space-y-2">
              <Label htmlFor="apiSecret" className="text-foreground">Secret Key</Label>
              <div className="relative">
                <Input
                  id="apiSecret"
                  type={showSecret ? 'text' : 'password'}
                  placeholder="Secret Key를 입력하세요"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="bg-background border-border text-foreground font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <Button 
              onClick={validateAndSaveKeys}
              disabled={isLoading || !apiKey || !apiSecret}
              className={cn(
                "w-full",
                setupMode === 'testnet' && "bg-orange-600 hover:bg-orange-700"
              )}
            >
              {isLoading ? '연결 확인중...' : (setupMode === 'testnet' ? '테스트넷 연동하기' : 'API 연동하기')}
            </Button>

            {/* Back Button */}
            <Button 
              variant="outline" 
              onClick={() => {
                setShowSetupForm(false);
                setApiKey('');
                setApiSecret('');
              }}
              className="w-full"
            >
              뒤로가기
            </Button>

            {/* Help Link */}
            <a 
              href={setupMode === 'testnet' 
                ? "https://testnet.binancefuture.com/en/futures/BTCUSDT"
                : "https://www.binance.com/en/my/settings/api-management"
              }
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              {setupMode === 'testnet' ? '바이낸스 테스트넷 열기' : '바이낸스 API 관리 페이지 열기'}
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main menu - show options
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-foreground">거래 모드 선택</CardTitle>
          <CardDescription>
            실거래 또는 테스트넷 모드를 선택하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mainnet Option */}
          <div className={cn(
            "p-4 border rounded-lg",
            hasMainnetKeys ? "border-green-500/50 bg-green-500/5" : "border-border"
          )}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                <span className="font-semibold text-foreground">실거래 (Mainnet)</span>
              </div>
              {hasMainnetKeys && (
                <CheckCircle className="h-5 w-5 text-green-500" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              실제 자금으로 바이낸스 선물 거래
            </p>
            <div className="flex gap-2">
              {hasMainnetKeys ? (
                <>
                  <Button onClick={onComplete} size="sm" className="flex-1">
                    실거래 시작
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setSetupMode('mainnet');
                      setShowSetupForm(true);
                    }}
                  >
                    재등록
                  </Button>
                </>
              ) : (
                <Button 
                  onClick={() => {
                    setSetupMode('mainnet');
                    setShowSetupForm(true);
                  }}
                  size="sm" 
                  className="flex-1"
                >
                  API 키 등록
                </Button>
              )}
            </div>
          </div>

          {/* Testnet Option */}
          <div className={cn(
            "p-4 border rounded-lg",
            hasTestnetKeys ? "border-orange-500/50 bg-orange-500/5" : "border-border"
          )}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-orange-500" />
                <span className="font-semibold text-foreground">테스트넷 (Testnet)</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">연습용</span>
              </div>
              {hasTestnetKeys && (
                <CheckCircle className="h-5 w-5 text-orange-500" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              가상 자금으로 위험 없이 연습 가능
            </p>
            <div className="flex gap-2">
              {hasTestnetKeys ? (
                <>
                  <Button 
                    onClick={() => {
                      // Store testnet mode preference
                      localStorage.setItem('binance_testnet_mode', 'true');
                      onComplete();
                    }}
                    size="sm" 
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                  >
                    테스트넷 시작
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setSetupMode('testnet');
                      setShowSetupForm(true);
                    }}
                  >
                    재등록
                  </Button>
                </>
              ) : (
                <Button 
                  onClick={() => {
                    setSetupMode('testnet');
                    setShowSetupForm(true);
                  }}
                  size="sm" 
                  className="flex-1 bg-orange-600 hover:bg-orange-700"
                >
                  테스트넷 키 등록
                </Button>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="text-center pt-2">
            <a 
              href="https://testnet.binancefuture.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              💡 테스트넷 계정이 없다면 여기서 무료로 생성하세요
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ApiKeySetup;
