// Benchmark helper: keep the child handle open so short-lived process CPU is counted.
using System;
using System.Diagnostics;
using System.Text;
using System.Runtime.InteropServices;
class ProcessMeter {
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
    [DllImport("psapi.dll", SetLastError=true)]
    static extern bool GetProcessMemoryInfo(IntPtr process,ref MemoryCounters counters,int size);
    [StructLayout(LayoutKind.Sequential)]
    struct MemoryCounters {
        public int cb, pageFaults;
        public UIntPtr peakWorkingSet,workingSet,peakPagedPool,pagedPool,peakNonPagedPool,nonPagedPool,pagefile,peakPagefile;
    }
    static string Quote(string value) {
        var output = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { output.Append('\\', slashes * 2 + 1); output.Append(c); slashes=0; continue; }
            output.Append('\\', slashes); slashes=0; output.Append(c);
        }
        output.Append('\\', slashes * 2); output.Append('"'); return output.ToString();
    }
    static int Main(string[] args) {
        if(args.Length==0) return 2;
        var arguments=new StringBuilder();
        for(int i=1;i<args.Length;i++) { if(i>1) arguments.Append(' '); arguments.Append(Quote(args[i])); }
        var p=new Process(); p.StartInfo=new ProcessStartInfo(args[0],arguments.ToString());
        p.StartInfo.UseShellExecute=false; p.StartInfo.CreateNoWindow=true;
        p.StartInfo.RedirectStandardOutput=true; p.StartInfo.RedirectStandardError=true;
        p.OutputDataReceived+=(s,e)=>{if(e.Data!=null) Console.Out.WriteLine(e.Data);};
        p.ErrorDataReceived+=(s,e)=>{if(e.Data!=null) Console.Error.WriteLine(e.Data);};
        var watch=Stopwatch.StartNew(); p.Start(); var handle=p.Handle;
        p.BeginOutputReadLine(); p.BeginErrorReadLine(); p.WaitForExit();
        long creation,exit,kernel,user;
        if(!GetProcessTimes(handle,out creation,out exit,out kernel,out user))return 3;
        var memory=new MemoryCounters(); memory.cb=Marshal.SizeOf(memory);
        GetProcessMemoryInfo(handle,ref memory,memory.cb);
        Console.Error.WriteLine("PROCESS_METER {0} {1} {2}",((kernel+user)/10000.0).ToString(System.Globalization.CultureInfo.InvariantCulture),watch.ElapsedMilliseconds,memory.peakWorkingSet.ToUInt64());
        return p.ExitCode;
    }
}
