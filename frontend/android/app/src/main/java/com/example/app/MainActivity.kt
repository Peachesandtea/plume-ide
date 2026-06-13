package com.example.app

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(TermuxBridgePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}

@CapacitorPlugin(name = "TermuxBridge")
class TermuxBridgePlugin : Plugin() {

    @PluginMethod
    fun runTermuxCommand(call: PluginCall) {
        val command = call.getString("command")
            ?: return call.reject("Command argument missing")

        val background = call.getBoolean("background", false) ?: false

        try {
            val intent = Intent().apply {
                component = ComponentName(
                    "com.termux",
                    "com.termux.app.RunCommandService"
                )
                action = "com.termux.RUN_COMMAND"
                putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
                putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", command))
                putExtra("com.termux.RUN_COMMAND_BACKGROUND", background)
            }
            context.startService(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to execute command: ${e.message}")
        }
    }

    @PluginMethod
    fun isTermuxInstalled(call: PluginCall) {
        val installed = try {
            context.packageManager.getPackageInfo("com.termux", 0)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
        val result = JSObject()
        result.put("installed", installed)
        call.resolve(result)
    }
}
