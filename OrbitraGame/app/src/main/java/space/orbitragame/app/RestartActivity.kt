package space.orbitragame.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Process

/**
 * "Uygulamayi yeniden baslat" icin ayri surecte (:phoenix) calisan yardimci.
 * Ana sureci tamamen sonlandirir ve uygulamayi temiz bir surecte yeniden acar.
 */
class RestartActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mainPid = intent.getIntExtra(EXTRA_MAIN_PID, -1)
        if (mainPid > 0 && mainPid != Process.myPid()) Process.killProcess(mainPid)
        val launch = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        startActivity(launch)
        finish()
        Runtime.getRuntime().exit(0)
    }

    companion object {
        private const val EXTRA_MAIN_PID = "main_pid"

        fun restart(context: Context) {
            val i = Intent(context, RestartActivity::class.java)
                .putExtra(EXTRA_MAIN_PID, Process.myPid())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        }
    }
}
