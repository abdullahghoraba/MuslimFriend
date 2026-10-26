package com.muslimfriend.app.overlay

import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

/**
 * Texts of the floating counter and the overlay card. The app sends them in its own language; the Arabic and English
 * ones here are the fallback (for data saved by an older version, before the app first syncs).
 */
object NativeLabels {
    private val RTL = setOf("ar", "ur", "fa")

    fun parse(o: JSONObject?): Map<String, String> =
        o?.keys()?.asSequence()?.associateWith { o.optString(it) }?.filterValues { it.isNotBlank() }.orEmpty()

    fun get(labels: Map<String, String>, language: String, key: String, ar: String, en: String): String =
        labels[key] ?: if (language == "ar") ar else en

    /** {name} style placeholders, as in the app's translation files. */
    fun fill(text: String, vararg values: Pair<String, String>): String =
        values.fold(text) { acc, (k, v) -> acc.replace("{{$k}}", v) }

    fun isRtl(language: String): Boolean = language in RTL

    /** Integers in the app language, always with 0-9 digits. */
    fun numbers(language: String): NumberFormat =
        NumberFormat.getIntegerInstance(Locale.forLanguageTag((if (language == "ar") "ar-EG" else language) + "-u-nu-latn"))
}
