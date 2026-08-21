Pod::Spec.new do |s|
  s.name           = 'PhotoTagger'
  s.version        = '1.0.0'
  s.summary        = 'On-device photo tagging via Apple Vision'
  s.description    = 'Runs Vision scene/face/human/aesthetics requests over local ' \
                     'Photos thumbnails and returns raw signals for ranking.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
