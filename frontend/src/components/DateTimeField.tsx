import { Box } from "@chakra-ui/react"
import DatePicker, { registerLocale } from "react-datepicker"
import { hr } from "date-fns/locale"
import "react-datepicker/dist/react-datepicker.css"
import "../datepicker.css"

// Croatian calendar locale (month/day names, week starts Monday). The visible
// format is forced via dateFormat below so it's dd/MM/yyyy HH:mm (24h)
// regardless of the OS region - which is what the native datetime-local input
// got wrong (it showed the browser's US MM/DD/YYYY hh:mm AM/PM).
registerLocale("hr", hr)

/**
 * Shared date + time picker used across the app (tournament creation, schedule
 * kickoff editing). Always renders dd/MM/yyyy HH:mm in 24h with the HR locale.
 * Value/onChange work in native Date objects; the caller converts to/from ISO.
 */
export function DateTimeField({
    value,
    onChange,
    minDate,
    placeholder = "DD/MM/GGGG HH:MM",
    timeIntervals = 5,
    compact = false,
}: {
    value: Date | null
    onChange: (d: Date | null) => void
    minDate?: Date
    placeholder?: string
    /** Minutes between selectable times in the dropdown (default 5). */
    timeIntervals?: number
    /** Smaller trigger input for tight rows (e.g. the schedule list). */
    compact?: boolean
}) {
    return (
        <Box className="futsal-datepicker-wrap" w="full">
            <DatePicker
                selected={value}
                onChange={onChange}
                showTimeSelect
                timeIntervals={timeIntervals}
                timeFormat="HH:mm"
                timeCaption="Vrijeme"
                dateFormat="dd/MM/yyyy HH:mm"
                locale="hr"
                minDate={minDate}
                placeholderText={placeholder}
                wrapperClassName="futsal-datepicker-input-wrap"
                className={
                    compact
                        ? "futsal-datepicker-input futsal-datepicker-input--compact"
                        : "futsal-datepicker-input"
                }
                popperPlacement="bottom-start"
            />
        </Box>
    )
}
