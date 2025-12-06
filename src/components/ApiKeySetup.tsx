import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Key, Eye, EyeOff, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApiKeySetupProps {
  onComplete: () => void;
}

const ApiKeySetup = ({ onComplete }: ApiKeySetupProps) => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [hasKeys, setHasKeys] = useState(false);
  const [showSetupForm, setShowSetupForm] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Check if user already has API keys
  useEffect(() => {
    const checkExistingKeys = async () => {
      if (!user) return;
      
      try {
        const { data } = await supabase
          .from('user_api_keys')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_testnet', false)
          .single();
        
        if (data) {
          setHasKeys(true);
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

    try {
      // First, delete existing keys (if any)
      await supabase
        .from('user_api_keys')
        .delete()
        .eq('user_id', user.id)
        .eq('is_testnet', false);

      // Save the new keys
      const { error: insertError } = await supabase
        .from('user_api_keys')
        .insert({
          user_id: user.id,
          api_key: apiKey.trim(),
          api_secret: apiSecret.trim(),
          is_testnet: false,
        });

      if (insertError) {
        throw insertError;
      }

      // Test the API connection
      const { data, error } = await supabase.functions.invoke('binance-api', {
        body: { action: 'getBalance' }
      });

      if (error || data?.error) {
        // Delete the invalid keys
        await supabase
          .from('user_api_keys')
          .delete()
          .eq('user_id', user.id)
          .eq('is_testnet', false);
        
        throw new Error(data?.error || 'API 연결 테스트 실패');
      }

      toast({
        title: '✅ API 연동 성공',
        description: '바이낸스 계정이 연결되었습니다.',
      });

      setHasKeys(true);
      setShowSetupForm(false);
      setApiKey('');
      setApiSecret('');
      onComplete();
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
  if (showSetupForm || !hasKeys) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg bg-card border-border">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-3 rounded-full w-fit bg-primary/10">
              <Key className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-foreground">바이낸스 API 연동</CardTitle>
            <CardDescription>
              실거래를 위해 바이낸스 API 키를 등록해주세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Warning */}
            <div className="p-3 border rounded-lg bg-yellow-500/10 border-yellow-500/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-yellow-500" />
                <div className="text-xs text-yellow-200">
                  <p className="font-semibold mb-1">API 키 생성 시 필수 설정:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-yellow-300/80">
                    <li>선물 거래(Futures) 권한 활성화</li>
                    <li>IP 제한: VPS IP(158.247.211.233) 등록</li>
                    <li>출금 권한은 <span className="text-red-400 font-bold">절대 비활성화</span></li>
                  </ul>
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
              className="w-full"
            >
              {isLoading ? '연결 확인중...' : 'API 연동하기'}
            </Button>

            {/* Back Button */}
            {hasKeys && (
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
            )}

            {/* Help Link */}
            <a 
              href="https://www.binance.com/en/my/settings/api-management"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              바이낸스 API 관리 페이지 열기
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main menu - show connected state
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-foreground">Biscal Trading System</CardTitle>
          <CardDescription>
            바이낸스 선물 스캘핑 트레이딩
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Connected Status */}
          <div className="p-4 border rounded-lg border-green-500/50 bg-green-500/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                <span className="font-semibold text-foreground">API 연결됨</span>
              </div>
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              바이낸스 선물 계정이 연결되어 있습니다.
            </p>
            <div className="flex gap-2">
              <Button onClick={onComplete} size="sm" className="flex-1">
                거래 시작
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowSetupForm(true)}
              >
                재등록
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ApiKeySetup;
