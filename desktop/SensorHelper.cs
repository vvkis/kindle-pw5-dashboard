using System;
using System.IO;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Principal;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;

// Small CLR host for the same unmodified sensor library. No PowerShell stays resident.
class SensorHelper {
    static string libraryDir;
    [STAThread]
    static int Main(string[] args) {
        if(args.Length!=2)return 2;
        libraryDir=Path.GetFullPath(args[0]);
        AppDomain.CurrentDomain.AssemblyResolve+=(sender,eventArgs)=>{
            string file=Path.Combine(libraryDir,new AssemblyName(eventArgs.Name).Name+".dll");
            return File.Exists(file)?Assembly.LoadFrom(file):null;
        };
        return Run(Path.GetFullPath(args[1]));
    }
    static void Collect(IHardware hardware,List<object> sensors,ref bool cpuAvailable) {
        hardware.Update();
        foreach(ISensor sensor in hardware.Sensors)if(sensor.Value.HasValue) {
            sensors.Add(new {id=sensor.Identifier.ToString(),name=sensor.Name,type=sensor.SensorType.ToString(),value=sensor.Value.Value});
            if(sensor.SensorType==SensorType.Temperature&&sensor.Identifier.ToString().IndexOf("cpu",StringComparison.OrdinalIgnoreCase)>=0&&sensor.Value.Value>0&&sensor.Value.Value<150)cpuAvailable=true;
        }
        foreach(IHardware child in hardware.SubHardware)Collect(child,sensors,ref cpuAvailable);
    }
    static void Write(string file,object value,JavaScriptSerializer json) {
        string temp=file+".tmp";
        File.WriteAllText(temp,json.Serialize(value),new System.Text.UTF8Encoding(false));
        if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);
    }
    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Run(string runtime) {
        Directory.CreateDirectory(runtime);
        string temp=Path.Combine(runtime,"tmp");Directory.CreateDirectory(temp);
        Environment.SetEnvironmentVariable("TEMP",temp);Environment.SetEnvironmentVariable("TMP",temp);
        string stop=Path.Combine(runtime,"sensors.stop"),output=Path.Combine(runtime,"sensors.json"),heartbeat=Path.Combine(runtime,"heartbeat");
        var json=new JavaScriptSerializer();Computer computer=null;FileStream fileLock=null;
        bool elevated=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        string driverVersion=null;
        using(var key=Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO")) {
            if(key!=null)driverVersion=key.GetValue("DisplayVersion") as string;
        }
        try {
            try{fileLock=new FileStream(Path.Combine(runtime,"sensors.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);}catch(IOException){return 0;}
            computer=new Computer {IsCpuEnabled=true,IsGpuEnabled=true};computer.Open();
            while(!File.Exists(stop)) {
                if(File.Exists(heartbeat)&&(DateTime.UtcNow-File.GetLastWriteTimeUtc(heartbeat)).TotalSeconds>45)break;
                try {
                    var sensors=new List<object>();var gpus=new List<object>();bool cpuAvailable=false;
                    foreach(IHardware hardware in computer.Hardware){Collect(hardware,sensors,ref cpuAvailable);if(hardware.HardwareType.ToString().StartsWith("Gpu"))gpus.Add(new{id=hardware.Identifier.ToString(),name=hardware.Name});}
                    string error=cpuAvailable?null:!elevated?"请点击启用 CPU 温度并完成管理员授权。":driverVersion==null?"CPU 温度组件尚未准备好，请点击启用 CPU 温度自动完成配置。":"驱动已安装，但暂未读到有效 CPU 温度，请重新启用采集器。";
                    string errorCode=cpuAvailable?null:!elevated?"not-elevated":driverVersion==null?"driver-missing":"cpu-unavailable";
                    Write(output,new {at=DateTime.UtcNow.ToString("o"),elevated=elevated,sensors=sensors,gpus=gpus,driver=new{name="PawnIO",version=driverVersion,installed=driverVersion!=null},error=error,errorCode=errorCode},json);
                }catch(Exception error){Write(output,new {at=DateTime.UtcNow.ToString("o"),elevated=elevated,sensors=new object[0],error=error.Message},json);}
                for(int i=0;i<15&&!File.Exists(stop);i++)Thread.Sleep(200);
            }
            return 0;
        }catch(Exception error){if(fileLock!=null)Write(output,new {at=DateTime.UtcNow.ToString("o"),elevated=elevated,sensors=new object[0],error=error.Message},json);return 1;}
        finally{if(computer!=null)computer.Close();if(fileLock!=null)fileLock.Dispose();}
    }
}
