import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import { ArrowLeft, Mail, Shield, Lock } from 'lucide-react';

const JOIN_CODE = '1266';
const JOIN_CODE_KEY = 'biscal_joined';

const authSchema = z.object({
  email: z.string().trim().email({ message: "올바른 이메일 주소를 입력하세요" }),
  password: z.string().min(6, { message: "비밀번호는 최소 6자 이상이어야 합니다" })
});

type AuthStep = 'joinCode' | 'credentials' | 'otp';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [step, setStep] = useState<AuthStep>(() => {
    // Check if already joined
    if (localStorage.getItem(JOIN_CODE_KEY) === 'true') {
      return 'credentials';
    }
    return 'joinCode';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [pendingOtp, setPendingOtp] = useState(false);
  const { signIn, signUp, user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Only navigate to home if user is logged in AND not in OTP verification flow
    if (!loading && user && !pendingOtp) {
      navigate('/');
    }
  }, [user, loading, navigate, pendingOtp]);

  const sendVerificationCode = async (targetEmail: string) => {
    const { data, error } = await supabase.functions.invoke('send-verification-code', {
      body: { email: targetEmail }
    });

    if (error) {
      throw new Error(error.message || '인증 코드 발송 실패');
    }

    return data;
  };

  const verifyCode = async (targetEmail: string, code: string) => {
    const { data, error } = await supabase.functions.invoke('verify-code', {
      body: { email: targetEmail, code }
    });

    if (error) {
      throw new Error(error.message || '인증 실패');
    }

    return data;
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = authSchema.safeParse({ email, password });
    if (!result.success) {
      toast({
        title: "입력 오류",
        description: result.error.errors[0].message,
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      if (isLogin) {
        // Set pending OTP flag before credential verification to prevent auto-navigation
        setPendingOtp(true);
        
        // For login: first verify credentials exist, then send OTP
        const { error } = await signIn(email, password);
        if (error) {
          setPendingOtp(false);
          let message = "로그인에 실패했습니다";
          if (error.message.includes("Invalid login credentials")) {
            message = "이메일 또는 비밀번호가 올바르지 않습니다";
          }
          toast({
            title: "로그인 실패",
            description: message,
            variant: "destructive"
          });
          return;
        }

        // Sign out temporarily and send OTP
        await supabase.auth.signOut();
        
        await sendVerificationCode(email);
        toast({
          title: "인증 코드 발송",
          description: "이메일로 6자리 인증 코드를 발송했습니다"
        });
        setStep('otp');
      } else {
        // For signup: just create account
        const { error } = await signUp(email, password);
        if (error) {
          let message = "회원가입에 실패했습니다";
          if (error.message.includes("already registered")) {
            message = "이미 가입된 이메일입니다";
          }
          toast({
            title: "회원가입 실패",
            description: message,
            variant: "destructive"
          });
        } else {
          toast({
            title: "회원가입 성공",
            description: "로그인해주세요"
          });
          setIsLogin(true);
        }
      }
    } catch (error: any) {
      toast({
        title: "오류",
        description: error.message || "처리 중 오류가 발생했습니다",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async () => {
    if (otpCode.length !== 6) {
      toast({
        title: "입력 오류",
        description: "6자리 인증 코드를 입력하세요",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      const verifyResult = await verifyCode(email, otpCode);
      
      if (!verifyResult.valid) {
        toast({
          title: "인증 실패",
          description: "잘못된 인증 코드이거나 만료되었습니다",
          variant: "destructive"
        });
        return;
      }

      // OTP verified, now actually sign in
      setPendingOtp(false);
      const { error } = await signIn(email, password);
      if (error) {
        toast({
          title: "로그인 실패",
          description: "로그인 중 오류가 발생했습니다",
          variant: "destructive"
        });
        return;
      }

      toast({
        title: "로그인 성공",
        description: "환영합니다!"
      });
      navigate('/');
    } catch (error: any) {
      toast({
        title: "인증 실패",
        description: error.message || "인증 코드 확인에 실패했습니다",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsLoading(true);
    try {
      await sendVerificationCode(email);
      toast({
        title: "재발송 완료",
        description: "새로운 인증 코드를 발송했습니다"
      });
      setOtpCode('');
    } catch (error: any) {
      toast({
        title: "발송 실패",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setStep('credentials');
    setOtpCode('');
    setPendingOtp(false);
  };

  const handleJoinCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCodeInput === JOIN_CODE) {
      sessionStorage.setItem(JOIN_CODE_KEY, 'true');
      toast({
        title: "접속 허용",
        description: "환영합니다!"
      });
      // 바로 거래화면으로 이동
      navigate('/');
    } else {
      toast({
        title: "접속 코드 오류",
        description: "올바른 코드를 입력하세요",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">로딩중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl font-black tracking-wider">
            <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent drop-shadow-sm">
              BISCAL
            </span>
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs mt-1">
            Binance Futures Scalping Terminal
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'joinCode' ? (
            <form onSubmit={handleJoinCodeSubmit} className="space-y-4">
              <div className="text-center space-y-2 mb-4">
                <div className="flex justify-center">
                  <div className="p-3 rounded-full bg-primary/10">
                    <Lock className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  접속 코드를 입력하세요
                </p>
              </div>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={4}
                  value={joinCodeInput}
                  onChange={setJoinCodeInput}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button 
                type="submit" 
                className="w-full"
                disabled={joinCodeInput.length !== 4}
              >
                접속
              </Button>
            </form>
          ) : step === 'credentials' ? (
            <>
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-foreground flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    이메일
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background border-border text-foreground"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-foreground">비밀번호</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-background border-border text-foreground"
                    required
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? '처리중...' : (isLogin ? '다음' : '회원가입')}
                </Button>
              </form>
              
              {/* 회원가입 토글 - 나중에 오픈 시 주석 해제
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isLogin ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
                </button>
              </div>
              */}
            </>
          ) : (
            <div className="space-y-6">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                뒤로
              </button>

              <div className="text-center space-y-2">
                <div className="flex justify-center">
                  <div className="p-3 rounded-full bg-primary/10">
                    <Shield className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <p className="text-foreground font-medium">이메일 인증</p>
                <p className="text-sm text-muted-foreground">
                  {email}로 발송된<br />6자리 인증 코드를 입력하세요
                </p>
              </div>

              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={setOtpCode}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button 
                onClick={handleOtpSubmit}
                className="w-full"
                disabled={isLoading || otpCode.length !== 6}
              >
                {isLoading ? '확인중...' : '로그인'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={isLoading}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  인증 코드 재발송
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
