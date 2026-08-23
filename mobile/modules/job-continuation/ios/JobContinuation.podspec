Pod::Spec.new do |s|
  s.name           = 'JobContinuation'
  s.version        = '1.0.0'
  s.summary        = 'Keeps a library job running after the app is backgrounded'
  s.description    = 'Holds an iOS 26 BGContinuedProcessingTask lease (with a ' \
                     'UIBackgroundTask grace window beneath it) for the running ' \
                     'library job, driven from the JS job runtime.'
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
