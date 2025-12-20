import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Key, Eye, EyeOff, AlertCircle, ExternalLink, ArrowLeft, FlaskConical } from 'lucide-react';

interface PaperApiKeySetupProps {
  onComplete: () => void;
}

const PaperApiKeySetup = ({ onComplete }: PaperApiKeySetupProps) => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

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
      // Delete existing testnet keys
      await supabase
        .from('user_api_keys')
        .delete()
        .eq('user_id', user.id)
        .eq('is_testnet', true);

      // Save new testnet keys
      const { error: insertError } = await supabase
        .from('user_api_keys')
        .insert({
          user_id: user.id,
          api_key: apiKey.trim(),
          api_secret: apiSecret.trim(),
          is_testnet: true,
        });

      if (insertError) {
        throw insertError;
      }

      toast({
        title: '✅ 테스트넷 API 연동 성공',
        description: '모의투자를 시작할 수 있습니다.',
      });

      setApiKey('');
      setApiSecret('');
      onComplete();
    } catch (error: any) {
      console.error('API key save error:', error);
      toast({
        title: 'API 연동 실패',
        description: error.message || '저장에 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-card border-border relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/auth')}
          className="absolute top-4 left-4 gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          뒤로
        </Button>
        
        <CardHeader className="text-center pt-12">
          
          <div className="mx-auto mb-4 p-3 rounded-full w-fit bg-amber-500/10">
            <FlaskConical className="h-8 w-8 text-amber-400" />
          </div>
          <CardTitle className="text-foreground flex items-center justify-center gap-2">
            <span>Exercise Room</span>
            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">TESTNET</span>
          </CardTitle>
          <CardDescription>
            모의투자를 위한 바이낸스 테스트넷 API 키를 등록해주세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Info */}
          <div className="p-3 border rounded-lg bg-blue-500/10 border-blue-500/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-blue-400" />
              <div className="text-xs text-blue-200">
                <p className="font-semibold mb-1">테스트넷 API 발급 방법:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-blue-300/80">
                  <li>testnet.binancefuture.com 접속</li>
                  <li>GitHub 또는 Google 계정으로 로그인</li>
                  <li>우측 상단 API 관리 메뉴 클릭</li>
                  <li>새 API 키 생성</li>
                </ol>
                <p className="mt-2 text-amber-300">
                  💡 테스트넷은 가상 자금으로 실제 거래와 동일하게 연습할 수 있습니다.
                </p>
              </div>
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <Label htmlFor="apiKey" className="text-foreground">Testnet API Key</Label>
            <Input
              id="apiKey"
              type="text"
              placeholder="테스트넷 API Key를 입력하세요"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="bg-background border-border text-foreground font-mono text-sm"
            />
          </div>

          {/* Secret Key Input */}
          <div className="space-y-2">
            <Label htmlFor="apiSecret" className="text-foreground">Testnet Secret Key</Label>
            <div className="relative">
              <Input
                id="apiSecret"
                type={showSecret ? 'text' : 'password'}
                placeholder="테스트넷 Secret Key를 입력하세요"
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
            className="w-full bg-amber-500 hover:bg-amber-600 text-black"
          >
            {isLoading ? '저장중...' : '모의투자 시작하기'}
          </Button>

          {/* Help Link */}
          <a 
            href="https://testnet.binancefuture.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            바이낸스 선물 테스트넷 열기
          </a>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaperApiKeySetup;
