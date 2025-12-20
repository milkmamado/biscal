import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import { ArrowLeft, Mail, Shield, FlaskConical, Zap } from 'lucide-react';

const authSchema = z.object({
  email: z.string().trim().email({ message: "올바른 이메일 주소를 입력하세요" }),
  password: z.string().min(6, { message: "비밀번호는 최소 6자 이상이어야 합니다" })
});

type AuthStep = 'credentials' | 'otp';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<AuthStep>('credentials');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingOtp, setPendingOtp] = useState(false);
  const { signIn, signUp, user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
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
        setPendingOtp(true);
        
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

        await supabase.auth.signOut();
        
        await sendVerificationCode(email);
        toast({
          title: "인증 코드 발송",
          description: "이메일로 6자리 인증 코드를 발송했습니다"
        });
        setStep('otp');
      } else {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="neon-text-cyan animate-pulse">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Cyberpunk Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Grid lines */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0, 255, 255, 0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 255, 255, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }}
        />
        
        {/* Gradient orbs */}
        <div className="absolute top-1/4 -left-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-purple-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px]" />
        
        {/* Scan lines */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 255, 0.1) 2px, rgba(0, 255, 255, 0.1) 4px)',
          }}
        />
      </div>

      {/* Main Card */}
      <div className="relative w-full max-w-md">
        {/* Glow effect behind card */}
        <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 rounded-2xl blur-xl opacity-50" />
        
        <div className="relative bg-card/80 backdrop-blur-xl border border-cyan-500/20 rounded-2xl p-8 shadow-2xl">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-cyan-400/50 rounded-tl-2xl" />
          <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-cyan-400/50 rounded-tr-2xl" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 border-cyan-400/50 rounded-bl-2xl" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-cyan-400/50 rounded-br-2xl" />

          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-5xl font-black tracking-widest mb-2 font-mono">
              <span className="neon-text-cyan neon-pulse">BISCAL</span>
            </h1>
            <div className="flex items-center justify-center gap-2 text-xs text-cyan-400/60 font-mono">
              <Zap className="h-3 w-3" />
              <span>FUTURES SCALPING TERMINAL</span>
              <Zap className="h-3 w-3" />
            </div>
            <div className="mt-3 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
          </div>

          {step === 'credentials' ? (
            <>
              <form onSubmit={handleCredentialsSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-cyan-300/80 text-xs font-mono flex items-center gap-2 uppercase tracking-wider">
                    <Mail className="h-3 w-3" />
                    Email Address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background/50 border-cyan-500/30 text-foreground font-mono placeholder:text-muted-foreground/50 focus:border-cyan-400 focus:ring-cyan-400/20 transition-all"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-cyan-300/80 text-xs font-mono uppercase tracking-wider">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-background/50 border-cyan-500/30 text-foreground font-mono placeholder:text-muted-foreground/50 focus:border-cyan-400 focus:ring-cyan-400/20 transition-all"
                    required
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-mono font-bold tracking-wider transition-all duration-300 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-400/40"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">◌</span>
                      PROCESSING...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      {isLogin ? 'ACCESS SYSTEM' : 'REGISTER'}
                    </span>
                  )}
                </Button>
              </form>
              
              {/* Exercise Room Button */}
              <div className="mt-8 pt-6 border-t border-cyan-500/20">
                <Button
                  variant="outline"
                  className="w-full gap-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:border-amber-400/60 hover:text-amber-300 font-mono tracking-wider transition-all duration-300"
                  onClick={() => navigate('/paper-trading')}
                >
                  <FlaskConical className="h-4 w-4" />
                  EXERCISE ROOM
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1 text-xs text-cyan-400/60 hover:text-cyan-400 transition-colors font-mono uppercase tracking-wider"
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>

              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <div className="p-4 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                    <Shield className="h-8 w-8 text-cyan-400" />
                  </div>
                </div>
                <div>
                  <p className="text-cyan-300 font-mono font-bold tracking-wider">VERIFICATION REQUIRED</p>
                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                    Enter 6-digit code sent to<br />
                    <span className="text-cyan-400">{email}</span>
                  </p>
                </div>
              </div>

              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={setOtpCode}
                >
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <InputOTPSlot 
                        key={index}
                        index={index} 
                        className="bg-background/50 border-cyan-500/30 text-cyan-400 font-mono text-lg w-10 h-12"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button 
                onClick={handleOtpSubmit}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-mono font-bold tracking-wider shadow-lg shadow-cyan-500/25"
                disabled={isLoading || otpCode.length !== 6}
              >
                {isLoading ? 'VERIFYING...' : 'CONFIRM ACCESS'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={isLoading}
                  className="text-xs text-cyan-400/50 hover:text-cyan-400 transition-colors font-mono uppercase tracking-wider disabled:opacity-50"
                >
                  Resend Code
                </button>
              </div>
            </div>
          )}

          {/* Status bar */}
          <div className="mt-8 pt-4 border-t border-cyan-500/10">
            <div className="flex items-center justify-between text-[10px] text-cyan-500/40 font-mono">
              <span>SYS::AUTH_PORTAL</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                ONLINE
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
