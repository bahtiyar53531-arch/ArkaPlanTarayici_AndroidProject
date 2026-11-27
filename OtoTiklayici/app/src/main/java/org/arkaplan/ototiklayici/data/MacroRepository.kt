package org.arkaplan.ototiklayici.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.MacroBundle
import java.io.File
import java.util.UUID

/** Makroları uygulamanın özel klasöründe JSON dosyaları olarak saklar. */
class MacroRepository(context: Context, scope: CoroutineScope) {
    private val dir = File(context.filesDir, "makrolar").apply { mkdirs() }
    private val mutex = Mutex()
    private val _macros = MutableStateFlow<List<Macro>>(emptyList())
    val macros: StateFlow<List<Macro>> = _macros.asStateFlow()

    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    init {
        scope.launch { reload() }
    }

    suspend fun reload() = mutex.withLock {
        val list = withContext(Dispatchers.IO) {
            dir.listFiles { f -> f.extension == "json" }.orEmpty().mapNotNull { file ->
                runCatching { json.decodeFromString(Macro.serializer(), file.readText()) }
                    .onFailure { Log.w(TAG, "Okunamadı: ${file.name}", it) }
                    .getOrNull()
            }
        }
        _macros.value = list.sortedByDescending { it.updatedAt }
        _loaded.value = true
    }

    fun get(id: String): Macro? = _macros.value.firstOrNull { it.id == id }

    suspend fun save(macro: Macro): Macro = mutex.withLock {
        val now = System.currentTimeMillis()
        val toSave = macro.copy(
            createdAt = if (macro.createdAt == 0L) now else macro.createdAt,
            updatedAt = now,
        )
        withContext(Dispatchers.IO) {
            val target = fileFor(toSave.id)
            val tmp = File(dir, "${toSave.id}.json.tmp")
            tmp.writeText(json.encodeToString(Macro.serializer(), toSave))
            if (!tmp.renameTo(target)) {
                target.delete()
                tmp.renameTo(target)
            }
        }
        _macros.value = (listOf(toSave) + _macros.value.filterNot { it.id == toSave.id })
            .sortedByDescending { it.updatedAt }
        toSave
    }

    /** Çalıştırma sayısını günceller; listeyi en son düzenlenene göre sıralamayı bozmaz. */
    suspend fun markRun(id: String) {
        val macro = get(id) ?: return
        mutex.withLock {
            val updated = macro.copy(runCount = macro.runCount + 1, lastRunAt = System.currentTimeMillis())
            withContext(Dispatchers.IO) {
                fileFor(id).writeText(json.encodeToString(Macro.serializer(), updated))
            }
            _macros.value = _macros.value.map { if (it.id == id) updated else it }
        }
    }

    suspend fun delete(id: String) = mutex.withLock {
        withContext(Dispatchers.IO) { fileFor(id).delete() }
        _macros.value = _macros.value.filterNot { it.id == id }
    }

    suspend fun duplicate(id: String, nameSuffix: String = " (kopya)"): Macro? {
        val source = get(id) ?: return null
        return save(source.copy(id = newId(), name = source.name + nameSuffix, createdAt = 0, runCount = 0, lastRunAt = 0))
    }

    fun exportJson(macros: List<Macro>): String =
        json.encodeToString(MacroBundle.serializer(), MacroBundle(exportedAt = System.currentTimeMillis(), macros = macros))

    /**
     * Yedek dosyasını veya tek bir makro JSON'unu içe aktarır. Çakışmayı önlemek için
     * her makroya yeni kimlik verilir. İçe aktarılan sayıyı döndürür.
     */
    suspend fun importJson(text: String): Int {
        val element = json.parseToJsonElement(text)
        val obj: JsonObject = element.jsonObject
        val incoming = if ("macros" in obj) {
            json.decodeFromJsonElement(MacroBundle.serializer(), obj).macros
        } else {
            listOf(json.decodeFromJsonElement(Macro.serializer(), obj))
        }
        incoming.forEach { save(it.copy(id = newId(), createdAt = 0)) }
        return incoming.size
    }

    private fun fileFor(id: String) = File(dir, "${sanitize(id)}.json")

    private fun sanitize(id: String) = id.filter { it.isLetterOrDigit() || it == '-' || it == '_' }

    companion object {
        private const val TAG = "MacroRepository"

        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            classDiscriminator = "tur"
            prettyPrint = false
        }

        fun newId(): String = UUID.randomUUID().toString()
    }
}
